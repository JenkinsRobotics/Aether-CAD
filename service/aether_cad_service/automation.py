"""Legacy Studio binding. CAD owns schemas and execution, the host saves files."""

import json
from pathlib import Path

from core.host.automation.commands import Command
from core.host.state import Problem

from . import automation_runtime

COMMANDS = tuple(
    Command(
        item["id"],
        item["title"],
        item["description"],
        item["action"],
        item["inputSchema"],
        item["writes"],
        "cad",
    )
    for item in json.loads(
        Path(__file__).with_name("automation-commands.json").read_text()
    )
)


def worker(request):
    try:
        return automation_runtime.worker(request)
    except automation_runtime.CommandError as error:
        raise Problem(error.status, error.message) from None


def execute(service, command_id, content, arguments):
    try:
        return automation_runtime.execute(service, command_id, content, arguments)
    except automation_runtime.CommandError as error:
        raise Problem(error.status, error.message) from None
