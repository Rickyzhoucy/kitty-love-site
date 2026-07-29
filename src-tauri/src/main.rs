use tauri::{WebviewUrl, WebviewWindowBuilder};

const CREDENTIAL_SERVICE: &str = "kitty-love-site";

fn credential() -> Result<keyring::Entry, String> {
    keyring::Entry::new(CREDENTIAL_SERVICE, "configured-server")
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn save_device_token(token: String) -> Result<(), String> {
    credential()?
        .set_password(&token)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn load_device_token() -> Result<Option<String>, String> {
    match credential()?.get_password() {
        Ok(token) => Ok(Some(token)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
fn delete_device_token() -> Result<(), String> {
    match credential()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            save_device_token,
            load_device_token,
            delete_device_token,
        ])
        .setup(|app| {
            let server_url = std::env::var("KITTY_SERVER_URL")
                .unwrap_or_else(|_| "http://localhost:3000".to_string());
            let url = server_url
                .parse::<url::Url>()
                .map_err(|error| error.to_string())?;
            let trusted_origin = url.origin().ascii_serialization();
            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
                .title("Kitty Love")
                .inner_size(340.0, 480.0)
                .min_inner_size(280.0, 360.0)
                .transparent(true)
                .decorations(false)
                .always_on_top(true)
                .resizable(true)
                .on_navigation(move |target| {
                    target.origin().ascii_serialization() == trusted_origin
                })
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to run Kitty Love desktop");
}
