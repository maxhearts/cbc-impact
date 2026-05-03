"""Command-line interface for the bot framework.

  bot new <name>           scaffold a new bot
  bot run <name>           start a chat REPL
  bot ls                   list bots
  bot reset <name>         archive logs + reset memory (keeps SOUL.md)
  bot logs <name> [id]     dump session transcript (latest if id omitted)
  bot consolidate <name> <id>   re-run consolidation on a past session
"""

from __future__ import annotations

import argparse
import datetime
import shutil
import sys
from pathlib import Path


def _root() -> Path:
    return Path(__file__).resolve().parent.parent


def _bots_dir() -> Path:
    return _root() / "bots"


def _template_dir() -> Path:
    return _root() / "template"


def _agent_dir(name: str) -> Path:
    return _bots_dir() / name


def cmd_new(args):
    dest = _agent_dir(args.name)
    if dest.exists():
        sys.exit(f"bot already exists: {dest}")
    dest.mkdir(parents=True)
    shutil.copytree(_template_dir() / "workspace", dest / "workspace")
    shutil.copy(_template_dir() / "config.toml", dest / "config.toml")
    print(f"created: {dest}")
    print("next:")
    print(f"  $EDITOR {dest}/config.toml         # backend, model, knobs")
    print(f"  $EDITOR {dest}/workspace/SOUL.md   # personality")
    print(f"  bot run {args.name}")


def cmd_ls(args):
    d = _bots_dir()
    if not d.exists() or not any(d.iterdir()):
        print("(no bots — try `bot new <name>`)")
        return
    for sub in sorted(d.iterdir()):
        if not sub.is_dir():
            continue
        log_dir = sub / "logs"
        sessions = sorted(log_dir.glob("session_*.jsonl")) if log_dir.exists() else []
        print(f"{sub.name:30}  sessions={len(sessions)}")


def cmd_run(args):
    agent_dir = _agent_dir(args.name)
    if not agent_dir.exists():
        sys.exit(f"no such bot: {args.name}")
    from .agent import Agent

    agent = Agent(agent_dir)
    print(f"[{args.name}] session={agent.session.session_id}  (Ctrl-D to end)")
    try:
        while True:
            try:
                user = input("you> ")
            except EOFError:
                print()
                break
            user = user.strip()
            if not user:
                continue
            try:
                reply = agent.turn(user)
            except Exception as exc:
                print(f"[error] {exc}", file=sys.stderr)
                continue
            print(f"{args.name}> {reply}")
    finally:
        try:
            result = agent.end()
        except Exception as exc:
            print(f"[consolidate failed] {exc}", file=sys.stderr)
            result = None
        if result is not None:
            print(f"[{args.name}] session ended; memory consolidated")
        else:
            print(f"[{args.name}] session ended")


def cmd_reset(args):
    agent_dir = _agent_dir(args.name)
    if not agent_dir.exists():
        sys.exit(f"no such bot: {args.name}")
    archive_root = agent_dir / "archive"
    archive_root.mkdir(exist_ok=True)
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    target = archive_root / stamp
    target.mkdir()

    if (agent_dir / "logs").exists():
        shutil.move(str(agent_dir / "logs"), str(target / "logs"))

    workspace = agent_dir / "workspace"
    if workspace.exists():
        ws_arch = target / "workspace"
        ws_arch.mkdir()
        for f in list(workspace.iterdir()):
            if args.full or f.name != "SOUL.md":
                shutil.move(str(f), str(ws_arch / f.name))
        # Restore from template — keep SOUL.md unless --full was passed.
        for f in (_template_dir() / "workspace").iterdir():
            if (workspace / f.name).exists():
                continue
            shutil.copy(f, workspace / f.name)

    print(f"reset: {args.name}{' [full]' if args.full else ''} (archived to {target})")


def cmd_logs(args):
    log_dir = _agent_dir(args.name) / "logs"
    if not log_dir.exists():
        sys.exit(f"no logs for {args.name}")
    files = sorted(log_dir.glob("session_*.jsonl"))
    if not files:
        print("(no sessions yet)")
        return
    if args.session:
        target = log_dir / f"session_{args.session}.jsonl"
        if not target.exists():
            sys.exit(f"no such session: {args.session}")
    else:
        target = files[-1]
    print(f"# {target.name}")
    print(target.read_text(), end="")


def cmd_consolidate(args):
    from .agent import Agent
    from .consolidate import consolidate as run_consolidate
    from .session import Session

    agent_dir = _agent_dir(args.name)
    if not agent_dir.exists():
        sys.exit(f"no such bot: {args.name}")
    agent = Agent(agent_dir)
    sess = Session.load(agent.log_dir, args.session)
    result = run_consolidate(agent.client, agent.memory, sess)
    print(result)


def main():
    p = argparse.ArgumentParser(prog="bot", description=__doc__)
    sub = p.add_subparsers(dest="cmd", required=True)

    p_new = sub.add_parser("new", help="scaffold a new bot")
    p_new.add_argument("name")
    p_new.set_defaults(func=cmd_new)

    p_run = sub.add_parser("run", help="chat with a bot")
    p_run.add_argument("name")
    p_run.set_defaults(func=cmd_run)

    p_ls = sub.add_parser("ls", help="list bots")
    p_ls.set_defaults(func=cmd_ls)

    p_reset = sub.add_parser("reset", help="archive logs and reset memory")
    p_reset.add_argument("name")
    p_reset.add_argument(
        "--full", action="store_true", help="also archive SOUL.md (full wipe)"
    )
    p_reset.set_defaults(func=cmd_reset)

    p_logs = sub.add_parser("logs", help="dump a session transcript")
    p_logs.add_argument("name")
    p_logs.add_argument("session", nargs="?", help="session id (default: latest)")
    p_logs.set_defaults(func=cmd_logs)

    p_con = sub.add_parser("consolidate", help="re-run consolidation on a session")
    p_con.add_argument("name")
    p_con.add_argument("session")
    p_con.set_defaults(func=cmd_consolidate)

    args = p.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
