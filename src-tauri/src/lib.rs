use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf, process::Command};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct OrtRuntimeStatus {
    initialized: bool,
    build_info: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct KokoroSynthesisRequest {
    chapter_index: usize,
    chapter_title: String,
    chapter_script: String,
    model_path: String,
    voices_path: String,
    voice: String,
    speed: f32,
    output_directory: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct KokoroSynthesisResult {
    output_path: String,
}

#[tauri::command]
fn check_ort_runtime() -> Result<OrtRuntimeStatus, String> {
    ort::init()
        .with_name("fourth-sloperation")
        .commit();

    Ok(OrtRuntimeStatus {
        initialized: true,
        build_info: ort::info().to_string(),
    })
}

#[tauri::command]
fn synthesize_chapter_audio(request: KokoroSynthesisRequest) -> Result<KokoroSynthesisResult, String> {
    let sanitized_title = request
        .chapter_title
        .chars()
        .map(|character| {
            if character.is_alphanumeric() || character == '-' || character == '_' {
                character
            } else {
                '_'
            }
        })
        .collect::<String>();
    let file_name = format!("{:02}_{}.wav", request.chapter_index + 1, sanitized_title);

    let output_directory = PathBuf::from(&request.output_directory);
    fs::create_dir_all(&output_directory)
        .map_err(|error| format!("Could not create output directory: {error}"))?;
    let output_path = output_directory.join(file_name);

    let script = r#"
import sys

from kokoro_onnx import Kokoro
import soundfile as sf

model_path, voices_path, voice, speed, text, output_path = sys.argv[1:7]
pipeline = Kokoro(model_path, voices_path)
samples, sample_rate = pipeline.create(text, voice=voice, speed=float(speed), lang="en-us")
sf.write(output_path, samples, sample_rate)
"#;

    let python_output = Command::new("python3")
        .arg("-c")
        .arg(script)
        .arg(&request.model_path)
        .arg(&request.voices_path)
        .arg(&request.voice)
        .arg(request.speed.to_string())
        .arg(&request.chapter_script)
        .arg(output_path.to_string_lossy().to_string())
        .output()
        .map_err(|error| {
            format!(
                "Failed to execute python3. Install python3 and pip install kokoro-onnx soundfile. Error: {error}"
            )
        })?;

    if !python_output.status.success() {
        let stderr = String::from_utf8_lossy(&python_output.stderr);
        return Err(format!(
            "Kokoro synthesis failed. Ensure kokoro-onnx and soundfile are installed, and model files are valid. Python stderr: {stderr}"
        ));
    }

    Ok(KokoroSynthesisResult {
        output_path: output_path.to_string_lossy().to_string(),
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            check_ort_runtime,
            synthesize_chapter_audio
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
