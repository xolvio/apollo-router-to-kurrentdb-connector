# Starstuff Custom Router

This project scaffolds a custom Apollo Router binary named `starstuff` with a native Rust plugin that maps GraphQL mutations to KurrentDB events.

## Requirements

- Rust toolchain 1.90.0 or newer (the repository targets `apollo-router` v2.6.2)

## Project Layout
- `src/plugins/kurrent_mapper/mapper.rs` – maps the mutations to KurrentDB events and persists them.
- `src/plugins/mutation_plugin.rs` – plugin that logs the mutations in the query.
- `router.yaml` – enables the plugin and provides its configuration.
- `supergraph-schema.graphql` – schema made according to schemas in the target-domain-schemas folder.

## How to start the project

```bash
docker compose up
```

The first build downloads a large dependency set for Apollo Router; allow several minutes to complete.

## How the mutations land in KurrentDB

  - The supergraph schema mirrors the JSON definitions under target-domain-schemas/.
  Every mutation field (e.g. recordLoanRequested) exposes an input whose shape matches the
  corresponding domain event payload. Schema validation guarantees clients can only send
  values that satisfy those field requirements.
  - When a mutation reaches the router, extract_mutations walks the parsed operation and
  resolves every argument (including nested objects and variables) into real JSON .
   The resulting MutationCall contains exactly the
  argument object the client supplied—so the input JSON still has the same structure as the
  domain event schema, and the metadata argument mirrors Metadata.schema.json.
  - The plugin hands those MutationCall values to KurrentService. For each call we:
      - choose a stream named graphql-mutation-<field> so every domain event type gets its own
  stream 
      - emit an event type like GraphQL.RecordLoanRequested, keeping the schema name
  recognizable 
      - serialize the entire call to JSON via EventData::json (so the stored body contains the
  input object and metadata exactly as GraphQL validated them) 
      - append it to KurrentDB over gRPC  and log the stream, type, and new UUID .



## Modifying the Plugins
Modify `router.yaml` to tweak the plugin configuration or add additional plugins.
