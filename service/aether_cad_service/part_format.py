"""CAD-owned file header gate; feature migrations remain in the document parser."""

import json
from importlib.resources import files

# Copied from the canonical document manifest by the native bundle build.
PART_FORMAT = json.loads(
    files("aether_cad_service").joinpath("data/part-format.json").read_text()
)
PART_DOCUMENT_VERSION = PART_FORMAT["current"]


def validate_part_header(document):
    if not isinstance(document, dict) or document.get("format") not in (
        "aether-part", "open-cad-part"
    ):
        raise ValueError("These settings require a native Aether CAD document.")
    version = document.get("formatVersion")
    if type(version) is not int or version not in PART_FORMAT["readable"]:
        raise ValueError(
            f"Unsupported Part format version: {version}. "
            "Update Aether CAD to open newer Part files."
        )


def validate_workspace_part_headers(workspace):
    for part in workspace.part_definitions.values():
        document = part.get("feature_document")
        if document is not None:
            validate_part_header(document)
