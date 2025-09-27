use apollo_parser::{Parser, cst::CstNode};
use apollo_router::{
    plugin::{Plugin, PluginInit},
    services::supergraph,
};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use tower::ServiceExt;
use tower::{BoxError, ServiceBuilder};

use apollo_parser::cst::Value::*;
use apollo_parser::cst::{Definition, Selection, SelectionSet, Value as ASTValue};

fn default_message() -> String {
    "starting my plugin".to_string()
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct PluginConfig {
    #[serde(default = "default_message")]
    pub message: String,
}

#[derive(Debug)]
pub struct MutationToKurrent;

#[async_trait::async_trait]
impl Plugin for MutationToKurrent {
    type Config = PluginConfig;

    async fn new(init: PluginInit<Self::Config>) -> Result<Self, BoxError>
    where
        Self: Sized,
    {
        tracing::info!(message = %init.config.message, "starstuff.hello_world plugin initialized");
        Ok(Self)
    }

    fn supergraph_service(&self, service: supergraph::BoxService) -> supergraph::BoxService {
        ServiceBuilder::new()
            .map_request(move |mut req: supergraph::Request| {
                let gql_req = req.supergraph_request.body();

                if let Some(query) = gql_req.query.as_ref() {
                    let calls = extract_mutations(query, &gql_req.variables);
                    if !calls.is_empty() {
                        // Store structured mutations on the request for downstream use
                        req.supergraph_request.extensions_mut().insert(calls.clone());
                        // Log a concise, structured summary
                        tracing::info!(mutations = ?calls, count = calls.len(), "Detected GraphQL mutation(s)");
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

use serde_json::Value;
use serde_json_bytes::{ByteString, Map as BytesMap, Value as BytesValue};

//serde Seriialize
#[derive(Debug, Clone, Serialize)]
pub struct MutationArg {
    pub name: String,
    pub value: Value, // variables resolved to JSON
}

#[derive(Debug, Clone, Serialize)]
pub struct MutationCall {
    pub operation_name: Option<String>,
    pub field_name: String,
    pub alias: Option<String>,
    pub arguments: Vec<MutationArg>,
    pub selected_fields: Vec<String>,
}

fn ast_value_to_json(value: &ASTValue, vars: &BytesMap<ByteString, BytesValue>) -> Option<Value> {
    match value {
        StringValue(s) => Some(Value::String(s.syntax().text().to_string())),
        IntValue(i) => Some(Value::String(i.syntax().text().to_string())),
        FloatValue(f) => Some(Value::String(f.syntax().text().to_string())),
        BooleanValue(b) => Some(Value::Bool(b.syntax().text() == "true")),
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
apollo_router::register_plugin!("starstuff", "mutation_plugin", MutationToKurrent);
