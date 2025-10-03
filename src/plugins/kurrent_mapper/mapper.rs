use kurrentdb::{Client, ClientSettings, EventData};
use schemars::JsonSchema;
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde_json::{Map, Value};
use std::{io, sync::Arc};
use tokio::task;
use tower::BoxError;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MutationArg {
    pub name: String,
    pub value: Value,
}

fn serialize_arguments_as_map<S>(args: &Vec<MutationArg>, serializer: S) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    let map: Map<String, Value> = args
        .iter()
        .map(|arg| (arg.name.clone(), arg.value.clone()))
        .collect();
    map.serialize(serializer)
}

fn deserialize_arguments_from_map<'de, D>(deserializer: D) -> Result<Vec<MutationArg>, D::Error>
where
    D: Deserializer<'de>,
{
    let map = Map::<String, Value>::deserialize(deserializer)?;
    Ok(map
        .into_iter()
        .map(|(name, value)| MutationArg { name, value })
        .collect())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MutationCall {
    pub operation_name: Option<String>,
    pub field_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub loan_id: Option<String>,
    pub alias: Option<String>,
    #[serde(
        serialize_with = "serialize_arguments_as_map",
        deserialize_with = "deserialize_arguments_from_map"
    )]
    pub arguments: Vec<MutationArg>,
    pub selected_fields: Vec<String>,
}

fn default_connection_string() -> String {
    "kurrentdb://kurrentdb:2113?tls=false&tlsVerifyCert=false".to_string()
}

fn default_stream_prefix() -> String {
    "graphql-mutation-".to_string()
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct KurrentConfig {
    #[serde(default = "default_connection_string")]
    pub connection_string: String,
    #[serde(default = "default_stream_prefix")]
    pub stream_prefix: String,
}

#[derive(Clone)]
pub struct KurrentService {
    client: Arc<Client>,
    stream_prefix: String,
}

pub trait MutationSink: Send + Sync {
    fn persist_mutations(&self, calls: Vec<MutationCall>);
}

impl KurrentService {
    pub async fn new(config: KurrentConfig) -> Result<Self, BoxError> {
        let settings: ClientSettings = config
            .connection_string
            .parse()
            .map_err(|err| -> BoxError { Box::new(err) })?;

        let client = Client::new(settings)
            .map_err(|err| -> BoxError { Box::new(io::Error::new(io::ErrorKind::Other, err)) })?;

        tracing::info!(connection = %config.connection_string, "KurrentService connected to KurrentDB");

        Ok(Self {
            client: Arc::new(client),
            stream_prefix: config.stream_prefix,
        })
    }

    async fn persist_batch(
        client: Arc<Client>,
        stream_prefix: String,
        calls: Vec<MutationCall>,
    ) -> Result<(), BoxError> {
        for call in calls {
            let stream_name = format!("{}{}", stream_prefix, call.field_name);
            let event_type = format!(
                "GraphQL.{}",
                call.operation_name.as_deref().unwrap_or(&call.field_name)
            );

            let event_id = Uuid::new_v4();
            let event = EventData::json(&event_type, &call)
                .map_err(|err| -> BoxError { Box::new(err) })?
                .id(event_id);

            client
                .append_to_stream(stream_name.clone(), &Default::default(), event)
                .await
                .map_err(|err| -> BoxError { Box::new(err) })?;

            tracing::info!(stream = %stream_name, event_type = %event_type, event_id = %event_id, "Persisted GraphQL mutation event to KurrentDB");
        }

        Ok(())
    }
}

impl MutationSink for KurrentService {
    fn persist_mutations(&self, calls: Vec<MutationCall>) {
        let client = self.client.clone();
        let stream_prefix = self.stream_prefix.clone();

        task::spawn(async move {
            if let Err(error) = KurrentService::persist_batch(client, stream_prefix, calls).await {
                tracing::error!(error = %error, "Failed to persist mutations to KurrentDB");
            }
        });
    }
}
