
async def read_csv_upload(file: UploadFile) -> pd.DataFrame:
    """Read and validate a CSV upload with a strict size limit."""

    if not file.filename:
        error_response("A CSV file is required.", 422)

    if not file.filename.lower().endswith(".csv"):
        error_response("Only CSV files are supported.", 415)

    chunks = []
    total_size = 0

    try:
        while True:
            chunk = await file.read(1024 * 1024)

            if not chunk:
                break

            total_size += len(chunk)

            if total_size > MAX_CSV_SIZE:
                error_response(
                    "CSV file exceeds the 10 MB size limit.",
                    413,
                )

            chunks.append(chunk)

        if total_size == 0:
            error_response("Uploaded file is empty.", 422)

        dataframe = pd.read_csv(
            BytesIO(b"".join(chunks)),
            on_bad_lines="error",
        )

        if dataframe.empty:
            error_response("CSV file contains no data.", 422)

        dataframe.columns = [
            str(column).strip()
            for column in dataframe.columns
        ]

        if any(not column for column in dataframe.columns):
            error_response(
                "CSV contains an empty column name.",
                422,
            )

        if dataframe.columns.duplicated().any():
            error_response(
                "CSV contains duplicate column names.",
                422,
            )

        if len(dataframe.columns) > 100:
            error_response(
                "CSV exceeds the maximum of 100 columns.",
                422,
            )

        return dataframe

    except pd.errors.EmptyDataError:
        error_response("CSV contains no readable data.", 422)

    except pd.errors.ParserError:
        error_response("Uploaded file is not a valid CSV.", 422)

    except UnicodeDecodeError:
        error_response("CSV file encoding could not be read.", 422)

    finally:
        await file.close()
