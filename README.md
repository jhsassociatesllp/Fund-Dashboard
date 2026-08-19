# Fund Administration Portal

A dashboard web application for browsing funds, clients, and AIF (Alternative
Investment Fund) scheme categories.

## Stack

- Backend: Python, FastAPI, MongoDB (via Motor, async driver)
- Frontend: HTML, CSS, vanilla JavaScript (no build step)

## Navigation structure

**Fund Name tab**
`Fund Name -> ABC Company / XYZ Company -> Client -> Client File`

**Fund Scheme tab**
`Fund Scheme -> AIF -> Category I / Category II / Category III -> Sub-scheme detail`

## Prerequisites

- Python 3.10+
- A running MongoDB instance (local install, Docker container, or MongoDB Atlas)

## Setup

1. Install MongoDB, or start it with Docker:
   ```
   docker run -d --name fund-dashboard-mongo -p 27017:27017 mongo:7
   ```

2. Create a virtual environment and install dependencies:
   ```
   cd backend
   python -m venv venv
   source venv/bin/activate        # Windows: venv\Scripts\activate
   pip install -r requirements.txt
   ```

3. Configure the database connection:
   ```
   cp .env.example .env
   ```
   Edit `.env` if your MongoDB instance is not running on the default
   `mongodb://localhost:27017`.

4. Run the application:
   ```
   uvicorn main:app --reload --host 0.0.0.0 --port 8000
   ```

5. Open `http://localhost:8000` in a browser.

On first run, the backend automatically seeds MongoDB with sample funds,
clients, and AIF category data (see `backend/seed_data.py`). Seeding only
runs when the relevant collections are empty, so data entered later is
never overwritten.

## Project structure

```
fund-dashboard/
  backend/
    main.py          FastAPI application and API routes
    database.py       MongoDB connection (Motor)
    models.py         Pydantic response schemas
    seed_data.py       Sample data seeding
    requirements.txt
    .env.example
  frontend/
    index.html
    css/style.css
    js/app.js
    assets/logo.svg    Placeholder logo mark - replace with your own
  README.md
```

## Replacing the placeholder logo

`frontend/assets/logo.svg` is a placeholder mark. Replace this file with
your company's actual logo (SVG or PNG both work; update the `<img>` tag
in `frontend/index.html` if you change the file name or extension). The
header text "FUND ADMINISTRATION PORTAL" in `index.html` can be replaced
with your company name.

## API reference

| Method | Path                                | Description                          |
|--------|--------------------------------------|---------------------------------------|
| GET    | /api/health                          | Database connectivity check           |
| GET    | /api/funds                           | List funds                            |
| GET    | /api/funds/{fund_id}/clients         | List clients under a fund             |
| GET    | /api/clients/{client_id}             | Full client file                      |
| GET    | /api/schemes                         | List schemes (e.g. AIF)               |
| GET    | /api/schemes/{scheme_id}/categories  | List categories under a scheme        |
| GET    | /api/categories/{category_id}        | Category detail with sub-schemes      |

## Extending the data model

To add more funds, clients, or categories permanently, insert documents
directly into MongoDB (via `mongosh`, MongoDB Compass, or a script) rather
than editing `seed_data.py`, since seeding only runs against an empty
database. `seed_data.py` remains useful as a reference for the document
shape each collection expects.
