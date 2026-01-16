// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::net::TcpStream;
use std::process::{Child, Command};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;
use tauri::Manager;

struct ServerProcess(Mutex<Option<Child>>);

fn start_server() -> Option<Child> {
    let current_dir = std::env::current_dir().ok()?;

    // If we're in src-tauri, go up to the project root
    let project_root = if current_dir.ends_with("src-tauri") {
        current_dir.parent()?.to_path_buf()
    } else {
        current_dir
    };

    let server_path = project_root.join("dist/server.js");

    // Check if we're in production (dist/server.js) or development
    let (cmd, args, working_dir) = if server_path.exists() {
        ("node", vec!["dist/server.js"], project_root)
    } else {
        // Development mode - run with tsx
        ("npx", vec!["tsx", "server.ts"], project_root)
    };

    println!("Starting AgentOS server...");
    println!("Working dir: {:?}", working_dir);

    let child = Command::new(cmd)
        .args(&args)
        .current_dir(&working_dir)
        .spawn()
        .ok()?;

    println!("Server started with PID: {}", child.id());
    Some(child)
}

fn wait_for_server(host: &str, port: u16, max_attempts: u32) -> bool {
    for attempt in 1..=max_attempts {
        if TcpStream::connect((host, port)).is_ok() {
            println!("Server ready after {} attempts", attempt);
            return true;
        }
        println!("Waiting for server... attempt {}/{}", attempt, max_attempts);
        thread::sleep(Duration::from_millis(500));
    }
    false
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // Start the Node.js server
            let server = start_server();

            if server.is_some() {
                // Wait for server to be ready (max 30 seconds)
                let ready = wait_for_server("127.0.0.1", 3011, 60);
                if !ready {
                    eprintln!("Warning: Server may not be ready");
                }
            } else {
                eprintln!("Warning: Could not start server - assuming it's already running");
            }

            // Store the server process handle for cleanup
            app.manage(ServerProcess(Mutex::new(server)));

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                // Kill the server when window closes
                if let Some(state) = window.try_state::<ServerProcess>() {
                    if let Ok(mut guard) = state.0.lock() {
                        if let Some(mut child) = guard.take() {
                            println!("Stopping server...");
                            let _ = child.kill();
                        }
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
