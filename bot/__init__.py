"""Chatbot agent framework: personality + memory + session logs.

Designed for small language models. Backend-agnostic — works with any
OpenAI-compatible HTTP API or a local Ollama server.
"""
from .agent import Agent, AgentConfig
from .llm import LLMClient, Message, OllamaClient, OpenRouterClient, make_client
from .memory import EpisodicEntry, Memory
from .session import Session

__all__ = [
    "Agent",
    "AgentConfig",
    "EpisodicEntry",
    "LLMClient",
    "Memory",
    "Message",
    "OllamaClient",
    "OpenRouterClient",
    "Session",
    "make_client",
]
