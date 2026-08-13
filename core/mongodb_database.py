"""MongoDB Atlas persistence for Second Wind.

This module mirrors the public API of ``core.database`` so the conversation
tree and FastAPI routes can switch from SQLite to Atlas without changing their
call sites. Conversation nodes are stored as separate documents with explicit
parent and child references, which preserves the existing DAG model.
"""

from __future__ import annotations

import html
import json
import os
import re
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Tuple

from dotenv import load_dotenv
from pymongo import ASCENDING, DESCENDING, MongoClient
from pymongo.errors import OperationFailure, PyMongoError


load_dotenv()

_client: Optional[MongoClient] = None
_database = None


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _get_database():
    global _client, _database

    if _database is not None:
        return _database

    uri = os.getenv("MONGODB_URI")
    if not uri:
        raise RuntimeError("MONGODB_URI is not configured")

    _client = MongoClient(
        uri,
        appname="second-wind",
        serverSelectionTimeoutMS=int(os.getenv("MONGODB_TIMEOUT_MS", "8000")),
        connectTimeoutMS=int(os.getenv("MONGODB_TIMEOUT_MS", "8000")),
        retryWrites=True,
    )
    _database = _client[os.getenv("MONGODB_DB", "second_wind")]
    return _database


def _json_value(value):
    if value is None or isinstance(value, (dict, list)):
        return value
    if isinstance(value, str):
        try:
            return json.loads(value)
        except (json.JSONDecodeError, TypeError):
            return value
    return value


def _json_string(value) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, str):
        return value
    return json.dumps(value)


def _iso_timestamp(value) -> str:
    if isinstance(value, datetime):
        return value.isoformat()
    if value:
        return str(value)
    return _now().isoformat()


def _attachment_document(document: Optional[dict]) -> Optional[dict]:
    if not document:
        return None
    result = dict(document)
    result["id"] = str(result.pop("_id"))
    if isinstance(result.get("created_at"), datetime):
        result["created_at"] = result["created_at"].isoformat()
    return result


def _semantic_text(content: str, summary, merge_metadata) -> str:
    parts = [content or ""]
    for value in (summary, merge_metadata):
        parsed = _json_value(value)
        if parsed:
            parts.append(json.dumps(parsed, ensure_ascii=False, sort_keys=True))
    return "\n".join(part for part in parts if part).strip()


def get_backend_name() -> str:
    return "mongodb_atlas"


def get_db_path() -> str:
    return f"atlas:{os.getenv('MONGODB_DB', 'second_wind')}"


def init_db() -> None:
    database = _get_database()
    database.command("ping")

    database.conversations.create_index(
        [("updated_at", DESCENDING)], name="conversations_updated_at"
    )
    database.nodes.create_index(
        [("conversation_id", ASCENDING), ("timestamp", ASCENDING)],
        name="nodes_conversation_timestamp",
    )
    database.nodes.create_index(
        [("conversation_id", ASCENDING), ("parent_ids", ASCENDING)],
        name="nodes_conversation_parents",
    )
    database.nodes.create_index(
        [("conversation_id", ASCENDING), ("branch_name", ASCENDING)],
        name="nodes_conversation_branch",
    )
    database.attachments.create_index(
        [("conversation_id", ASCENDING)], name="attachments_conversation"
    )
    database.attachments.create_index(
        [("node_id", ASCENDING)], name="attachments_node"
    )
    print(
        "MongoDB Atlas initialized successfully "
        f"(database={database.name})."
    )


def get_database_status() -> dict:
    try:
        database = _get_database()
        database.command("ping")
        return {
            "backend": get_backend_name(),
            "connected": True,
            "database": database.name,
            "collections": {
                "conversations": database.conversations.estimated_document_count(),
                "nodes": database.nodes.estimated_document_count(),
                "attachments": database.attachments.estimated_document_count(),
            },
            "search_index": os.getenv("MONGODB_SEARCH_INDEX", "second_wind_search"),
            "vector_index": os.getenv("MONGODB_VECTOR_INDEX", "second_wind_vector"),
        }
    except Exception as exc:
        return {
            "backend": get_backend_name(),
            "connected": False,
            "database": os.getenv("MONGODB_DB", "second_wind"),
            "error": type(exc).__name__,
        }


def migrate_json_to_sqlite() -> int:
    """Compatibility no-op for the existing startup hook."""
    return 0


def list_conversations() -> List[Dict]:
    database = _get_database()
    conversations = []
    for document in database.conversations.find().sort("updated_at", DESCENDING):
        conversations.append(
            {
                "id": str(document["_id"]),
                "name": document.get("name", str(document["_id"])),
                "updated_at": _iso_timestamp(document.get("updated_at")),
            }
        )
    return conversations


def create_conversation(conversation_id: str, name: Optional[str] = None) -> None:
    now = _now()
    _get_database().conversations.insert_one(
        {
            "_id": conversation_id,
            "name": name or conversation_id,
            "current_node_id": None,
            "created_at": now,
            "updated_at": now,
        }
    )


def delete_conversation(conversation_id: str) -> bool:
    database = _get_database()
    result = database.conversations.delete_one({"_id": conversation_id})
    if not result.deleted_count:
        return False

    attachment_files = [
        item.get("filename")
        for item in database.attachments.find(
            {"conversation_id": conversation_id}, {"filename": 1}
        )
    ]
    database.nodes.delete_many({"conversation_id": conversation_id})
    database.attachments.delete_many({"conversation_id": conversation_id})

    upload_dir = ".forky_conversations/uploads"
    for filename in filter(None, attachment_files):
        filepath = os.path.join(upload_dir, filename)
        try:
            if os.path.exists(filepath):
                os.remove(filepath)
        except OSError:
            pass
    return True


def conversation_exists(conversation_id: str) -> bool:
    return (
        _get_database().conversations.count_documents(
            {"_id": conversation_id}, limit=1
        )
        > 0
    )


def update_conversation_timestamp(conversation_id: str) -> None:
    _get_database().conversations.update_one(
        {"_id": conversation_id}, {"$set": {"updated_at": _now()}}
    )


def rename_conversation(conversation_id: str, new_name: str) -> bool:
    result = _get_database().conversations.update_one(
        {"_id": conversation_id},
        {"$set": {"name": new_name, "updated_at": _now()}},
    )
    return result.matched_count > 0


def get_conversation_current_node(conversation_id: str) -> Optional[str]:
    document = _get_database().conversations.find_one(
        {"_id": conversation_id}, {"current_node_id": 1}
    )
    return document.get("current_node_id") if document else None


def set_conversation_current_node(conversation_id: str, node_id: str) -> None:
    _get_database().conversations.update_one(
        {"_id": conversation_id},
        {"$set": {"current_node_id": node_id, "updated_at": _now()}},
    )


def save_node(
    conversation_id: str,
    node_id: str,
    content: str,
    role: str,
    branch_name: Optional[str] = None,
    timestamp: Optional[str] = None,
    node_type: str = "message",
    merge_metadata: Optional[str] = None,
    state_summary_cache: Optional[str] = None,
) -> None:
    database = _get_database()
    parsed_merge = _json_value(merge_metadata)
    parsed_summary = _json_value(state_summary_cache)

    database.nodes.update_one(
        {"_id": node_id},
        {
            "$set": {
                "conversation_id": conversation_id,
                "content": content,
                "role": role,
                "branch_name": branch_name,
                "timestamp": _iso_timestamp(timestamp),
                "node_type": node_type,
                "merge_metadata": parsed_merge,
                "state_summary_cache": parsed_summary,
                "semantic_text": _semantic_text(
                    content, parsed_summary, parsed_merge
                ),
                "updated_at": _now(),
            },
            "$setOnInsert": {
                "parent_ids": [],
                "children_ids": [],
                "created_at": _now(),
            },
        },
        upsert=True,
    )


def get_all_nodes(conversation_id: str) -> Dict[str, Dict]:
    nodes = {}
    cursor = _get_database().nodes.find({"conversation_id": conversation_id})
    for document in cursor:
        node_id = str(document["_id"])
        nodes[node_id] = {
            "id": node_id,
            "content": document.get("content", ""),
            "role": document.get("role", "user"),
            "branch_name": document.get("branch_name"),
            "timestamp": _iso_timestamp(document.get("timestamp")),
            "node_type": document.get("node_type", "message"),
            "merge_metadata": _json_string(document.get("merge_metadata")),
            "state_summary_cache": _json_string(
                document.get("state_summary_cache")
            ),
            "children_ids": [str(value) for value in document.get("children_ids", [])],
            "parent_ids": [str(value) for value in document.get("parent_ids", [])],
        }
    return nodes


def add_edge(parent_id: str, child_id: str) -> None:
    database = _get_database()
    database.nodes.update_one(
        {"_id": parent_id}, {"$addToSet": {"children_ids": child_id}}
    )
    database.nodes.update_one(
        {"_id": child_id}, {"$addToSet": {"parent_ids": parent_id}}
    )


def find_root_node_id(conversation_id: str) -> Optional[str]:
    document = _get_database().nodes.find_one(
        {
            "conversation_id": conversation_id,
            "$or": [
                {"parent_ids": {"$exists": False}},
                {"parent_ids": {"$size": 0}},
            ],
        },
        {"_id": 1},
    )
    return str(document["_id"]) if document else None


def get_node_parents(node_id: str) -> List[str]:
    document = _get_database().nodes.find_one({"_id": node_id}, {"parent_ids": 1})
    return [str(value) for value in document.get("parent_ids", [])] if document else []


def get_node_children(node_id: str) -> List[str]:
    document = _get_database().nodes.find_one({"_id": node_id}, {"children_ids": 1})
    return [str(value) for value in document.get("children_ids", [])] if document else []


def delete_node(node_id: str) -> Tuple[bool, Optional[str]]:
    database = _get_database()
    node = database.nodes.find_one({"_id": node_id})
    if not node:
        return False, None

    parents = list(node.get("parent_ids", []))
    if len(parents) != 1:
        return False, None

    parent_id = parents[0]
    children = list(node.get("children_ids", []))
    nodes_to_delete = [node_id]
    actual_parent_id = parent_id

    parent = database.nodes.find_one({"_id": parent_id})
    if (
        parent
        and node.get("role") == "assistant"
        and parent.get("role") == "user"
        and len(parent.get("parent_ids", [])) == 1
    ):
        nodes_to_delete.append(parent_id)
        actual_parent_id = parent["parent_ids"][0]
        for child in parent.get("children_ids", []):
            if child != node_id and child not in children:
                children.append(child)

    children = [child for child in children if child not in nodes_to_delete]

    database.nodes.update_many(
        {},
        {
            "$pull": {
                "parent_ids": {"$in": nodes_to_delete},
                "children_ids": {"$in": nodes_to_delete},
            }
        },
    )

    if children:
        database.nodes.update_many(
            {"_id": {"$in": children}},
            {"$addToSet": {"parent_ids": actual_parent_id}},
        )
        database.nodes.update_one(
            {"_id": actual_parent_id},
            {"$addToSet": {"children_ids": {"$each": children}}},
        )

    attachment_files = [
        item.get("filename")
        for item in database.attachments.find(
            {"node_id": {"$in": nodes_to_delete}}, {"filename": 1}
        )
    ]
    database.attachments.delete_many({"node_id": {"$in": nodes_to_delete}})
    database.nodes.delete_many({"_id": {"$in": nodes_to_delete}})

    upload_dir = ".forky_conversations/uploads"
    for filename in filter(None, attachment_files):
        filepath = os.path.join(upload_dir, filename)
        try:
            if os.path.exists(filepath):
                os.remove(filepath)
        except OSError:
            pass

    return True, str(actual_parent_id)


def _highlight_content(content: str, query: str, width: int = 180) -> str:
    content = content or ""
    match = re.search(re.escape(query), content, flags=re.IGNORECASE)
    if not match:
        return html.escape(content[:width])

    start = max(0, match.start() - width // 2)
    end = min(len(content), match.end() + width // 2)
    before = html.escape(content[start:match.start()])
    hit = html.escape(content[match.start():match.end()])
    after = html.escape(content[match.end():end])
    prefix = "..." if start else ""
    suffix = "..." if end < len(content) else ""
    return f"{prefix}{before}<mark>{hit}</mark>{after}{suffix}"


def _search_snippet(document: dict, query: str) -> str:
    highlights = document.get("highlights") or []
    if highlights:
        pieces = []
        for item in highlights[0].get("texts", []):
            text = html.escape(item.get("value", ""))
            pieces.append(f"<mark>{text}</mark>" if item.get("type") == "hit" else text)
        if pieces:
            return "".join(pieces)
    return _highlight_content(document.get("content", ""), query)


def search_nodes(query: str, limit: int = 50) -> List[Dict]:
    if not query or not query.strip():
        return []

    database = _get_database()
    query = query.strip()
    search_index = os.getenv("MONGODB_SEARCH_INDEX", "second_wind_search")

    pipeline = [
        {
            "$search": {
                "index": search_index,
                "compound": {
                    "should": [
                        {
                            "text": {
                                "query": query,
                                "path": "content",
                                "fuzzy": {"maxEdits": 1},
                            }
                        },
                        {"text": {"query": query, "path": "branch_name"}},
                    ],
                    "minimumShouldMatch": 1,
                },
                "highlight": {"path": "content"},
            }
        },
        {"$limit": max(1, min(limit, 100))},
        {
            "$lookup": {
                "from": "conversations",
                "localField": "conversation_id",
                "foreignField": "_id",
                "as": "conversation",
            }
        },
        {
            "$project": {
                "content": 1,
                "conversation_id": 1,
                "conversation_name": {"$first": "$conversation.name"},
                "role": 1,
                "timestamp": 1,
                "score": {"$meta": "searchScore"},
                "highlights": {"$meta": "searchHighlights"},
            }
        },
    ]

    try:
        documents = list(database.nodes.aggregate(pipeline))
    except (OperationFailure, PyMongoError):
        documents = list(
            database.nodes.find(
                {
                    "$or": [
                        {"content": {"$regex": re.escape(query), "$options": "i"}},
                        {"branch_name": {"$regex": re.escape(query), "$options": "i"}},
                    ]
                }
            ).limit(max(1, min(limit, 100)))
        )

    conversation_ids = {doc.get("conversation_id") for doc in documents}
    conversation_names = {
        doc["_id"]: doc.get("name", str(doc["_id"]))
        for doc in database.conversations.find(
            {"_id": {"$in": list(filter(None, conversation_ids))}},
            {"name": 1},
        )
    }

    results = []
    for document in documents:
        conversation_id = document.get("conversation_id")
        results.append(
            {
                "node_id": str(document["_id"]),
                "conversation_id": conversation_id,
                "conversation_name": document.get("conversation_name")
                or conversation_names.get(conversation_id, conversation_id),
                "role": document.get("role", "unknown"),
                "snippet": _search_snippet(document, query),
                "timestamp": _iso_timestamp(document.get("timestamp")),
                "score": document.get("score"),
            }
        )
    return results


def find_semantic_matches(
    query: str,
    conversation_id: Optional[str] = None,
    exclude_node_ids: Optional[List[str]] = None,
    limit: int = 5,
) -> List[Dict]:
    if not query or not query.strip():
        return []

    database = _get_database()
    vector_index = os.getenv("MONGODB_VECTOR_INDEX", "second_wind_vector")
    model = os.getenv("MONGODB_EMBEDDING_MODEL", "voyage-4")
    excluded = set(exclude_node_ids or [])
    requested = max(1, min(limit, 20))

    vector_stage = {
        "index": vector_index,
        "path": "semantic_text",
        "query": query.strip(),
        "model": model,
        "numCandidates": max(50, requested * 10),
        "limit": min(100, requested + len(excluded) + 5),
    }
    if conversation_id:
        vector_stage["filter"] = {"conversation_id": {"$eq": conversation_id}}

    pipeline = [
        {"$vectorSearch": vector_stage},
        {
            "$project": {
                "conversation_id": 1,
                "content": 1,
                "role": 1,
                "branch_name": 1,
                "node_type": 1,
                "timestamp": 1,
                "score": {"$meta": "vectorSearchScore"},
            }
        },
    ]

    try:
        documents = list(database.nodes.aggregate(pipeline))
    except (OperationFailure, PyMongoError) as exc:
        raise RuntimeError(
            "Atlas Vector Search is not ready. Create the second_wind_vector "
            "index and wait until its status is Active."
        ) from exc

    matches = []
    for document in documents:
        node_id = str(document["_id"])
        if node_id in excluded:
            continue
        matches.append(
            {
                "node_id": node_id,
                "conversation_id": document.get("conversation_id"),
                "content": document.get("content", ""),
                "role": document.get("role", "unknown"),
                "branch_name": document.get("branch_name"),
                "node_type": document.get("node_type", "message"),
                "timestamp": _iso_timestamp(document.get("timestamp")),
                "score": document.get("score"),
            }
        )
        if len(matches) >= requested:
            break
    return matches


def save_attachment(
    attachment_id: str,
    conversation_id: str,
    filename: str,
    original_name: str,
    mime_type: str,
    attachment_type: str,
    size_bytes: int,
    node_id: Optional[str] = None,
) -> None:
    _get_database().attachments.insert_one(
        {
            "_id": attachment_id,
            "conversation_id": conversation_id,
            "node_id": node_id,
            "filename": filename,
            "original_name": original_name,
            "mime_type": mime_type,
            "attachment_type": attachment_type,
            "size_bytes": size_bytes,
            "created_at": _now(),
        }
    )


def get_attachment(attachment_id: str) -> Optional[Dict]:
    return _attachment_document(
        _get_database().attachments.find_one({"_id": attachment_id})
    )


def get_attachments_by_ids(attachment_ids: List[str]) -> List[Dict]:
    if not attachment_ids:
        return []
    return [
        _attachment_document(document)
        for document in _get_database().attachments.find(
            {"_id": {"$in": attachment_ids}}
        )
    ]


def get_node_attachments(node_id: str) -> List[Dict]:
    return [
        _attachment_document(document)
        for document in _get_database().attachments.find({"node_id": node_id})
    ]


def link_attachments_to_node(attachment_ids: List[str], node_id: str) -> int:
    if not attachment_ids:
        return 0
    result = _get_database().attachments.update_many(
        {"_id": {"$in": attachment_ids}, "node_id": None},
        {"$set": {"node_id": node_id}},
    )
    return result.modified_count


def delete_attachment(attachment_id: str) -> bool:
    return (
        _get_database().attachments.delete_one({"_id": attachment_id}).deleted_count
        > 0
    )


def get_orphan_attachments(max_age_hours: int = 24) -> List[Dict]:
    cutoff = _now() - timedelta(hours=max_age_hours)
    return [
        _attachment_document(document)
        for document in _get_database().attachments.find(
            {"node_id": None, "created_at": {"$lt": cutoff}}
        )
    ]


def get_nodes_attachments(node_ids: List[str]) -> List[Dict]:
    if not node_ids:
        return []
    return [
        _attachment_document(document)
        for document in _get_database().attachments.find(
            {"node_id": {"$in": node_ids}}
        ).sort("created_at", ASCENDING)
    ]


def cleanup_orphan_attachments(max_age_hours: int = 24) -> int:
    orphans = get_orphan_attachments(max_age_hours)
    upload_dir = ".forky_conversations/uploads"

    for attachment in orphans:
        filepath = os.path.join(upload_dir, attachment["filename"])
        try:
            if os.path.exists(filepath):
                os.remove(filepath)
        except OSError:
            pass

    if orphans:
        _get_database().attachments.delete_many(
            {"_id": {"$in": [item["id"] for item in orphans]}}
        )
    return len(orphans)
