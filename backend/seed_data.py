"""
Seeds MongoDB with sample data the first time the application starts.
If the collections already contain data, seeding is skipped so the
application never overwrites data entered later through the API.

Funds, clients, and corpus movements are NOT seeded here - those only
come into existence through the Admin Portal (create a fund, then upload
its Client Master / Corpus Movement file). Only the Fund Scheme reference
data (AIF categories) ships with sample content.
"""

from database import schemes_collection, categories_collection


async def seed_if_empty():
    if await schemes_collection.count_documents({}) == 0:
        await schemes_collection.insert_many([
            {"_id": "aif", "name": "AIF", "full_name": "Alternative Investment Fund"},
        ])

    if await categories_collection.count_documents({}) == 0:
        await categories_collection.insert_many([
            {
                "_id": "cat-1",
                "scheme_id": "aif",
                "name": "Category I",
                "description": (
                    "Funds investing in start-ups, early-stage ventures, SMEs, "
                    "infrastructure and other socially or economically desirable sectors, "
                    "as designated by SEBI and the Government of India."
                ),
                "sub_schemes": [
                    {
                        "name": "Growth Ventures Fund I",
                        "sebi_reg_no": "IN/AIF1/22-23/1045",
                        "launch_date": "2022-08-01",
                        "aum_inr_cr": 312.4,
                        "strategy": "Early-stage venture capital across technology and healthcare",
                    },
                    {
                        "name": "Infrastructure Growth Fund",
                        "sebi_reg_no": "IN/AIF1/21-22/0987",
                        "launch_date": "2021-11-15",
                        "aum_inr_cr": 540.0,
                        "strategy": "Infrastructure and social sector development",
                    },
                ],
            },
            {
                "_id": "cat-2",
                "scheme_id": "aif",
                "name": "Category II",
                "description": (
                    "Funds that do not fall under Category I or III and do not undertake "
                    "leverage other than for day-to-day operations, including private equity "
                    "funds and debt funds."
                ),
                "sub_schemes": [
                    {
                        "name": "Private Credit Opportunities Fund",
                        "sebi_reg_no": "IN/AIF2/23-24/2210",
                        "launch_date": "2023-05-10",
                        "aum_inr_cr": 890.6,
                        "strategy": "Structured private credit and mezzanine financing",
                    },
                ],
            },
            {
                "_id": "cat-3",
                "scheme_id": "aif",
                "name": "Category III",
                "description": (
                    "Funds employing diverse or complex trading strategies, including "
                    "investment in listed or unlisted derivatives, with the objective of "
                    "generating short-term returns."
                ),
                "sub_schemes": [
                    {
                        "name": "Absolute Return Strategies Fund",
                        "sebi_reg_no": "IN/AIF3/23-24/3305",
                        "launch_date": "2023-02-20",
                        "aum_inr_cr": 421.8,
                        "strategy": "Long-short equity with derivative overlay",
                    },
                    {
                        "name": "Quantitative Alpha Fund",
                        "sebi_reg_no": "IN/AIF3/24-25/3801",
                        "launch_date": "2024-04-05",
                        "aum_inr_cr": 176.3,
                        "strategy": "Systematic, model-driven multi-asset trading",
                    },
                ],
            },
        ])
