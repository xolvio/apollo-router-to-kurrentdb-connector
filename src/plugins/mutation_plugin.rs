use apollo_parser::{Parser, cst::CstNode};
use apollo_router::{
    plugin::{Plugin, PluginInit},
    services::supergraph,
};
use schemars::JsonSchema;
use serde::Deserialize;
use std::sync::Arc;
use tower::ServiceExt;
use tower::{BoxError, ServiceBuilder};

use apollo_parser::cst::Value::*;
use apollo_parser::cst::{Definition, Selection, SelectionSet, Value as ASTValue};

use crate::plugins::kurrent_mapper::{
    KurrentConfig, KurrentService, MutationArg, MutationCall, MutationSink,
};

fn default_message() -> String {
    "starting my plugin".to_string()
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct PluginConfig {
    #[serde(default = "default_message")]
    pub message: String,
    #[serde(flatten)]
    pub kurrent: KurrentConfig,
}

pub struct MutationInterceptor {
    mutation_sink: Arc<dyn MutationSink>,
}

#[async_trait::async_trait]
impl Plugin for MutationInterceptor {
    type Config = PluginConfig;

    async fn new(init: PluginInit<Self::Config>) -> Result<Self, BoxError>
    where
        Self: Sized,
    {
        let service = Arc::new(KurrentService::new(init.config.kurrent).await?);
        let sink: Arc<dyn MutationSink> = service;

        tracing::info!(message = %init.config.message, "starstuff.mutation_plugin initialized with KurrentService");

        Ok(Self {
            mutation_sink: sink,
        })
    }

    fn supergraph_service(&self, service: supergraph::BoxService) -> supergraph::BoxService {
        let mutation_sink = self.mutation_sink.clone();
        ServiceBuilder::new()
            .map_request(move |mut req: supergraph::Request| {
                let gql_req = req.supergraph_request.body();

                if let Some(query) = gql_req.query.as_ref() {
                    let calls = extract_mutations(query, &gql_req.variables);
                    if !calls.is_empty() {
                        req.supergraph_request.extensions_mut().insert(calls.clone());
                        tracing::info!(mutations = ?calls, count = calls.len(), "Detected GraphQL mutation(s)");
                        mutation_sink.persist_mutations(calls);
                    }
                }

                req
            })
            .service(service)
            .boxed()
    }

    fn name(&self) -> &'static str
    where
        Self: Sized,
    {
        "hello_world"
    }
}

impl MutationInterceptor {
    #[cfg(test)]
    pub fn with_sink(sink: Arc<dyn MutationSink>) -> Self {
        Self {
            mutation_sink: sink,
        }
    }
}

use serde_json::Value;
use serde_json_bytes::{ByteString, Map as BytesMap, Value as BytesValue};

fn ast_value_to_json(value: &ASTValue, vars: &BytesMap<ByteString, BytesValue>) -> Option<Value> {
    match value {
        StringValue(s) => serde_json::from_str(&s.syntax().text().to_string()).ok(),
        IntValue(i) => serde_json::from_str(&i.syntax().text().to_string()).ok(),
        FloatValue(f) => serde_json::from_str(&f.syntax().text().to_string()).ok(),
        BooleanValue(b) => serde_json::from_str(&b.syntax().text().to_string()).ok(),
        NullValue(_) => Some(Value::Null),
        EnumValue(e) => Some(Value::String(e.syntax().text().to_string())),
        Variable(var) => {
            let name = var.name()?.text();
            let v = vars.get(name.as_str())?;
            Some(serde_json::to_value(v.clone()).unwrap())
        }
        ListValue(list) => {
            let mut arr = Vec::new();
            for v in list.values() {
                arr.push(ast_value_to_json(&v, vars).unwrap_or(Value::Null));
            }
            Some(Value::Array(arr))
        }
        ObjectValue(obj) => {
            let mut map = serde_json::Map::new();
            for field in obj.object_fields() {
                let name = field.name()?.text().to_string();
                let val = field.value()?;
                map.insert(name, ast_value_to_json(&val, vars).unwrap_or(Value::Null));
            }
            Some(Value::Object(map))
        }
    }
}

fn collect_top_level_response_field_names(selection_set: Option<SelectionSet>) -> Vec<String> {
    let mut out = Vec::new();
    if let Some(selections) = selection_set {
        for selection in selections.selections() {
            if let Selection::Field(field) = selection {
                let name = field
                    .alias()
                    .and_then(|a| a.name().map(|n| n.text().to_string()))
                    .or_else(|| field.name().map(|n| n.text().to_string()));
                if let Some(n) = name {
                    out.push(n);
                }
            }
        }
    }
    out
}

fn collect_args(
    field: &apollo_parser::cst::Field,
    vars: &BytesMap<ByteString, BytesValue>,
) -> Vec<MutationArg> {
    let mut args = Vec::new();
    if let Some(arguments) = field.arguments() {
        for a in arguments.arguments() {
            let name = a.name().map(|n| n.text().to_string()).unwrap_or_default();
            let val = a
                .value()
                .and_then(|v| ast_value_to_json(&v, vars))
                .unwrap_or(Value::Null);
            args.push(MutationArg { name, value: val });
        }
    }
    args
}

pub fn extract_mutations(
    query: &str,
    variables: &BytesMap<ByteString, BytesValue>,
) -> Vec<MutationCall> {
    let ast = Parser::new(query).parse();
    let doc = ast.document();
    let mut calls = Vec::new();

    for def in doc.definitions() {
        if let Definition::OperationDefinition(op) = def {
            if let Some(op_type) = op.operation_type() {
                if op_type.mutation_token().is_some() {
                    let op_name = op.name().map(|n| n.text().to_string());
                    if let Some(sel_set) = op.selection_set() {
                        for selection in sel_set.selections() {
                            if let Selection::Field(field) = selection {
                                let field_name = field
                                    .name()
                                    .map(|n| n.text().to_string())
                                    .unwrap_or_default();
                                let alias = field
                                    .alias()
                                    .and_then(|a| a.name().map(|n| n.text().to_string()));
                                let arguments = collect_args(&field, variables);
                                let selected_fields =
                                    collect_top_level_response_field_names(field.selection_set());
                                calls.push(MutationCall {
                                    operation_name: op_name.clone(),
                                    field_name,
                                    alias,
                                    arguments,
                                    selected_fields,
                                });
                            }
                        }
                    }
                }
            }
        }
    }

    calls
}
apollo_router::register_plugin!("starstuff", "mutation_plugin", MutationInterceptor);

#[cfg(test)]
mod tests {
    use super::*;
    use apollo_router::plugin::{Plugin, test};
    use apollo_router::services::supergraph;
    use serde_json::json;
    use serde_json_bytes::{ByteString, Map as BytesMap};
    use std::sync::{Arc as StdArc, Mutex};

    #[derive(Default)]
    struct MockMutationSink {
        calls: StdArc<Mutex<Vec<Vec<MutationCall>>>>,
    }

    impl MockMutationSink {
        fn recorded(&self) -> Vec<Vec<MutationCall>> {
            self.calls.lock().unwrap().clone()
        }
    }

    impl MutationSink for MockMutationSink {
        fn persist_mutations(&self, calls: Vec<MutationCall>) {
            self.calls.lock().unwrap().push(calls);
        }
    }

    fn build_supergraph_request(query: &str, variables: serde_json::Value) -> supergraph::Request {
        let vars: serde_json::Map<String, serde_json::Value> =
            serde_json::from_value(variables).unwrap();
        let mut bytes_map = BytesMap::new();
        for (key, value) in vars {
            bytes_map.insert(
                ByteString::from(key),
                serde_json_bytes::to_value(value).unwrap(),
            );
        }

        supergraph::Request::fake_builder()
            .query(query.to_string())
            .variables(bytes_map)
            .build()
            .unwrap()
    }

    #[tokio::test]
    async fn detects_mutations_and_invokes_sink() {
        let sink = StdArc::new(MockMutationSink::default());
        let interceptor = MutationInterceptor::with_sink(sink.clone());

        let mut mock_service = test::MockSupergraphService::new();
        mock_service
            .expect_call()
            .returning(|req: supergraph::Request| {
                Ok(supergraph::Response::fake_builder()
                    .context(req.context)
                    .build()
                    .unwrap())
            });
        mock_service.expect_clone().return_once(|| {
            let mut inner = test::MockSupergraphService::new();
            inner.expect_call().returning(|req: supergraph::Request| {
                Ok(supergraph::Response::fake_builder()
                    .context(req.context)
                    .build()
                    .unwrap())
            });
            inner
        });

        let service = interceptor.supergraph_service(mock_service.boxed());

        let mutation = r#"
            mutation RecordSummary {
              recordAutomatedSummary(
                input: {
                  CreditScoreSummary: "credit score summary"
                  IncomeAndEmploymentSummary: "income"
                  LoanToIncomeSummary: "ratio"
                  MaritalStatusAndDependentsSummary: "status"
                  RecommendedFurtherInvestigation: "none"
                  SummarizedBy: "Analyst"
                  SummarizedAt: "2024-09-29T00:00:00Z"
                }
                metadata: {
                  correlationId: "corr"
                  causationId: "cause"
                  transactionTimestamp: "2024-09-29T00:00:00Z"
                }
              ) {
                CreditScoreSummary
              }
            }
        "#;

        let request = build_supergraph_request(mutation, json!({}));

        let response = service.oneshot(request).await.unwrap();
        assert!(response.response.status().is_success());

        let recorded = sink.recorded();
        assert_eq!(1, recorded.len());
        let calls = &recorded[0];
        assert_eq!(1, calls.len());
        let call = &calls[0];
        assert_eq!("recordAutomatedSummary", call.field_name);
        let input = call
            .arguments
            .iter()
            .find(|arg| arg.name == "input")
            .expect("input argument");
        assert_eq!(
            json!("credit score summary"),
            input.value["CreditScoreSummary"]
        );
    }

    #[tokio::test]
    async fn ignores_non_mutation_operations() {
        let sink = StdArc::new(MockMutationSink::default());
        let interceptor = MutationInterceptor::with_sink(sink.clone());

        let mut mock_service = test::MockSupergraphService::new();
        mock_service
            .expect_call()
            .returning(|req: supergraph::Request| {
                Ok(supergraph::Response::fake_builder()
                    .context(req.context)
                    .build()
                    .unwrap())
            });
        mock_service.expect_clone().return_once(|| {
            let mut inner = test::MockSupergraphService::new();
            inner.expect_call().returning(|req: supergraph::Request| {
                Ok(supergraph::Response::fake_builder()
                    .context(req.context)
                    .build()
                    .unwrap())
            });
            inner
        });

        let service = interceptor.supergraph_service(mock_service.boxed());

        let query = "query { __typename }";
        let request = build_supergraph_request(query, json!({}));

        let response = service.oneshot(request).await.unwrap();
        assert!(response.response.status().is_success());
        assert!(sink.recorded().is_empty());
    }
}
