# Starstuff Custom Router

This project scaffolds a custom Apollo Router binary named `starstuff` with a native Rust plugin.

## Requirements

- Rust toolchain 1.90.0 or newer (the repository targets `apollo-router` v2.6.2)

## Project Layout

- `src/plugins/mutation_plugin.rs` – plugin that logs the mutations in the query.
- `router.yaml` – enables the plugin and provides its configuration.
- `supergraph-schema.graphql` – schema made according to schemas in the target-domain-schemas folder.

## Building

```bash
cargo build
```

The first build downloads a large dependency set for Apollo Router; allow several minutes to complete.

## Running Locally

```bash
cargo run -- --hot-reload --config router.yaml --supergraph supergraph-schema.graphql
```

You should see a log entry similar to:

```
INFO starstuff.mutation_plugin plugin initialized message="starting my plugin"
```

## Modifying the Plugins
Modify `router.yaml` to tweak the plugin configuration or add additional plugins.
