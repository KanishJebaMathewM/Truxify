from fastapi import FastAPI

app = FastAPI(
    title="Truxify ML Engine",
    description="Machine Learning microservice for Truxify",
    version="1.0.0",
)

@app.get("/")
async def root():
    return {"message": "Truxify ML Engine is running"}

@app.get("/health")
async def health():
    return {"status": "healthy"}