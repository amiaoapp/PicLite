#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if std::env::args().any(|arg| arg == "--mcp") {
        piclite_lib::run_mcp();
    } else {
        piclite_lib::run();
    }
}
