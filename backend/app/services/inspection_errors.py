class InspectionError(Exception):
    """Only safe, application-authored messages may be returned to HTTP callers or logs."""

    def __init__(
        self, code: str, message: str, status_code: int = 502, retry_after: int | None = None
    ):
        super().__init__(message)
        self.code = code
        self.status_code = status_code
        self.retry_after = retry_after
