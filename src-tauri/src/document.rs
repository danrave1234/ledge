use serde::Serialize;
use std::path::Path;

const MAX_DOCUMENT_BYTES: usize = 5 * 1024 * 1024;
const MAX_DOCUMENT_CHARS: usize = 200_000;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractedDocument {
    kind: &'static str,
    name: String,
    mime: &'static str,
    size: usize,
    text: String,
}

fn normalize_and_bound(text: String) -> Result<String, String> {
    let normalized = text.replace("\r\n", "\n").replace('\r', "\n");
    if normalized.chars().count() > MAX_DOCUMENT_CHARS {
        return Err("document text is too large (200,000 characters maximum)".into());
    }
    Ok(normalized)
}

fn extract(name: &str, bytes: &[u8]) -> Result<ExtractedDocument, String> {
    if bytes.len() > MAX_DOCUMENT_BYTES {
        return Err("document is too large (5 MB maximum)".into());
    }
    let extension = Path::new(name)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let (mime, text) = match extension.as_str() {
        "txt" => (
            "text/plain",
            std::str::from_utf8(bytes)
                .map_err(|_| "document is not valid UTF-8")?
                .to_owned(),
        ),
        "md" => (
            "text/markdown",
            std::str::from_utf8(bytes)
                .map_err(|_| "document is not valid UTF-8")?
                .to_owned(),
        ),
        "json" => {
            let text = std::str::from_utf8(bytes).map_err(|_| "document is not valid UTF-8")?;
            serde_json::from_str::<serde_json::Value>(text)
                .map_err(|_| "JSON document is malformed")?;
            ("application/json", text.to_owned())
        }
        "csv" => (
            "text/csv",
            std::str::from_utf8(bytes)
                .map_err(|_| "document is not valid UTF-8")?
                .to_owned(),
        ),
        "pdf" => {
            if bytes.windows(8).any(|part| part == b"/Encrypt") {
                return Err("encrypted PDFs are not supported".into());
            }
            let text = pdf_extract::extract_text_from_mem(bytes)
                .map_err(|_| "PDF is malformed or unsupported")?;
            if text.trim().is_empty() {
                return Err("PDF contains no extractable text; scanned or image-only PDFs are not supported".into());
            }
            ("application/pdf", text)
        }
        _ => return Err("unsupported document type; use .txt, .md, .json, .csv, or .pdf".into()),
    };
    Ok(ExtractedDocument {
        kind: "document",
        name: name.to_owned(),
        mime,
        size: bytes.len(),
        text: normalize_and_bound(text)?,
    })
}

#[tauri::command]
pub fn extract_document(name: String, bytes: Vec<u8>) -> Result<ExtractedDocument, String> {
    extract(&name, &bytes)
}

#[cfg(test)]
mod tests {
    use super::{MAX_DOCUMENT_BYTES, extract};

    #[test]
    fn extracts_supported_utf8_and_normalizes_lines() {
        let result = extract("notes.md", b"one\r\ntwo").unwrap();
        assert_eq!(result.mime, "text/markdown");
        assert_eq!(result.text, "one\ntwo");
    }

    #[test]
    fn rejects_invalid_and_oversized_documents() {
        assert!(extract("bad.json", b"{").unwrap_err().contains("malformed"));
        assert!(extract("bad.txt", &[0xff]).unwrap_err().contains("UTF-8"));
        assert!(
            extract("bad.exe", b"x")
                .unwrap_err()
                .contains("unsupported")
        );
        assert!(
            extract("large.txt", &vec![b'x'; MAX_DOCUMENT_BYTES + 1])
                .unwrap_err()
                .contains("5 MB")
        );
    }

    #[test]
    fn gives_explicit_pdf_errors() {
        assert!(
            extract("secret.pdf", b"%PDF /Encrypt")
                .unwrap_err()
                .contains("encrypted")
        );
        assert!(
            extract("broken.pdf", b"not a pdf")
                .unwrap_err()
                .contains("malformed")
        );
    }
}
