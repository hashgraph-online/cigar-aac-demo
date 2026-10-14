"""Package the current public working-tree sources without Git history or secrets.

Run with npm run package:source after npm run setup. No third-party Python
packages are used. Requires a Git checkout so ignored local files stay excluded.
"""

import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import re
import subprocess
import zipfile


ROOT = Path(__file__).resolve().parent.parent
ROOT_FILES = {
    ".env.example", ".gitattributes", ".gitignore", "CONTRIBUTING.md",
    "LICENSE", "NOTICE", "README.md", "SECURITY.md", "THIRD_PARTY_NOTICES.md",
    "package.json", "package-lock.json", "playwright.config.js",
    "requirements.txt", "vitest.config.js",
}
SOURCE_DIRS = {".github", "apps", "docs", "packages", "scripts", "tests"}
EXCLUDED_PARTS = {
    ".git", ".claude", ".codex", ".venv", "node_modules", "dist", "coverage",
    "__pycache__", "artifacts", "test-results", "playwright-report",
}


def main():
    listed = subprocess.run(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
        cwd=ROOT, capture_output=True, check=True,
    )
    names = sorted(set(name.decode("utf-8") for name in listed.stdout.split(b"\0") if name))
    contents = {}
    for name in names:
        relative = PurePosixPath(name)
        parts = relative.parts
        if relative.is_absolute() or ".." in parts or "\\" in name:
            raise ValueError(f"Unsafe source path: {name}")
        if any(part in EXCLUDED_PARTS for part in parts):
            continue
        if any(part.startswith(".env") for part in parts) and name != ".env.example":
            continue
        if name not in ROOT_FILES and parts[0] not in SOURCE_DIRS:
            raise ValueError(f"Unrecognized public source path; review the allow-list: {name}")
        path = ROOT / name
        if any(parent.is_symlink() for parent in [path, *path.parents] if parent != ROOT.parent):
            raise ValueError(f"Symlinks are not packaged: {name}")
        if not path.exists():  # A locally removed tracked file is not current source.
            continue
        if not path.is_file():
            raise ValueError(f"Not a regular source file: {name}")
        contents[name] = path.read_bytes()
    if not ROOT_FILES.issubset(contents):
        raise ValueError("The source set is missing required release files")
    version = json.loads(contents["package.json"])["version"]
    if not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+(?:-[a-zA-Z0-9.-]+)?", version):
        raise ValueError("Unsafe release version")
    prefix = f"hol-cigar-aac-demo-{version}"
    manifest = {
        "schema": "hol.demo.source-manifest.v1", "version": version,
        "files": {name: {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}
                  for name, data in contents.items()},
    }
    contents["SOURCE-MANIFEST.json"] = (json.dumps(manifest, indent=2) + "\n").encode()
    archive = io.BytesIO()
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as output:
        for name, data in sorted(contents.items()):
            entry = zipfile.ZipInfo(f"{prefix}/{name}", date_time=(1980, 1, 1, 0, 0, 0))
            entry.create_system = 3
            entry.external_attr = 0o100644 << 16
            entry.compress_type = zipfile.ZIP_DEFLATED
            output.writestr(entry, data, compresslevel=9)
    data = archive.getvalue()
    checksum = hashlib.sha256(data).hexdigest()
    destination = ROOT / "artifacts" / "releases"
    destination.mkdir(parents=True, exist_ok=True)
    filename = f"{prefix}-{checksum[:12]}.zip"
    target = destination / filename
    if target.exists():
        if target.read_bytes() != data:
            raise ValueError("Existing archive does not match its expected content")
    else:
        with target.open("xb") as output:
            output.write(data)
    checksum_path = destination / f"{filename}.sha256"
    expected = f"{checksum}  {filename}\n"
    if checksum_path.exists():
        if checksum_path.read_text() != expected:
            raise ValueError("Existing checksum file does not match the archive")
    else:
        with checksum_path.open("x") as output:
            output.write(expected)
    print(json.dumps({"archive": str(target), "sha256": checksum,
                      "source_files": len(manifest["files"]), "bytes": len(data)}, indent=2))


if __name__ == "__main__":
    main()
