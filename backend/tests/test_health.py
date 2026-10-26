def test_health(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "service": "assemblypilot-backend",
        "version": "0.1.0",
    }


def test_cors_allows_configured_origin(client):
    response = client.options(
        "/api/inspect",
        headers={"Origin": "http://localhost:3000", "Access-Control-Request-Method": "POST"},
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:3000"


def test_cors_rejects_other_origins(client):
    response = client.options(
        "/api/inspect",
        headers={"Origin": "https://untrusted.example", "Access-Control-Request-Method": "POST"},
    )
    assert response.status_code == 400
    assert "access-control-allow-origin" not in response.headers
