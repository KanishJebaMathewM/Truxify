# backend/ml/export_schema.py
# Run this script to regenerate docs/ml-api-schema.json
# Usage: python backend/ml/export_schema.py
#
# Run this whenever you change any FastAPI route to keep the schema
# in sync. CI will fail if the schema changes without this being re-run.

import json
import sys
import os

# Add the parent directory to path so we can import main
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from main import app

def export_schema():
    schema = app.openapi()
    
    # Ensure docs/ directory exists
    docs_dir = os.path.join(os.path.dirname(__file__), "..", "..", "docs")
    os.makedirs(docs_dir, exist_ok=True)
    
    output_path = os.path.join(docs_dir, "ml-api-schema.json")
    
    with open(output_path, "w") as f:
        json.dump(schema, f, indent=2)
    
    print(f"✅ Schema exported to: {output_path}")
    print(f"   Endpoints documented: {len(schema.get('paths', {}))}")

if __name__ == "__main__":
    export_schema()