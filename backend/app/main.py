from fastapi import FastAPI

app = FastAPI(title="Amplifier API")


@app.get("/")
async def root() -> dict[str, str]:
    return {"message": "Amplifier API"}


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
