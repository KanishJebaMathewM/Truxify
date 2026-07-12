import glob
import os

for f in glob.glob('backend/ml/tests/test_*.py'):
    with open(f, 'r') as file:
        content = file.read()
    
    content = content.replace("client = TestClient(app)", "client = TestClient(app, headers={'X-API-Key': 'test_key'})")
    
    with open(f, 'w') as file:
        file.write(content)
