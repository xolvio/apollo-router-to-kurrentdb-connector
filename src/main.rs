mod plugins;

fn main() {
    if let Err(error) = apollo_router::main() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}
