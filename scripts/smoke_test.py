#!/usr/bin/env python3
"""Run a three-turn tool-calling conversation through the local proxy."""

import argparse
import json
import os
import sys
import uuid

DEFAULT_BASE_URL = "http://127.0.0.1:8901/v1"
DEFAULT_MODEL = "claude-haiku-4-5-20251001"
SYSTEM_PROMPT = (
    "You are Avinash, a concise weather assistant. "
    "Start every direct answer with 'Weather demo:'. "
    "Clearly identify supplied weather observations as dummy data."
)
WEATHER_TOOL = {
    "type": "function",
    "function": {
        "name": "get_weather",
        "description": "Get the current weather for a city.",
        "parameters": {
            "type": "object",
            "properties": {
                "city": {"type": "string", "description": "City name"},
                "unit": {"type": "string", "enum": ["celsius", "fahrenheit"]},
            },
            "required": ["city", "unit"],
            "additionalProperties": False,
        },
        "strict": True,
    },
}


def parse_args():
    parser = argparse.ArgumentParser(
        description=__doc__,
        epilog="Requires the OpenAI Python SDK: python3 -m pip install openai",
    )
    parser.add_argument(
        "--base-url", default=os.getenv("CLAUDE_PROXY_BASE_URL") or DEFAULT_BASE_URL
    )
    parser.add_argument(
        "--api-key", default=os.getenv("CLAUDE_PROXY_API_KEY") or "local-proxy"
    )
    parser.add_argument(
        "--model", default=os.getenv("CLAUDE_PROXY_MODEL") or DEFAULT_MODEL
    )
    parser.add_argument("--session-id", default=str(uuid.uuid4()))
    parser.add_argument("--timeout", type=float, default=300)
    return parser.parse_args()


def create_client(args):
    try:
        from openai import OpenAI
    except ModuleNotFoundError as error:
        raise RuntimeError(
            "OpenAI SDK missing; run: python3 -m pip install openai"
        ) from error
    return OpenAI(
        api_key=args.api_key,
        base_url=args.base_url,
        default_headers={"X-Claude-Session-Id": args.session_id},
        max_retries=0,
        timeout=args.timeout,
    )


def print_completion(turn, description, completion):
    print(f"\n=== Turn {turn}: {description} ===")
    print(json.dumps(completion.model_dump(), indent=2, default=str))


def require_system_prompt(completion):
    content = completion.choices[0].message.content or ""
    if not content.startswith("Weather demo:"):
        raise RuntimeError("the response did not follow the request system prompt")


def dummy_weather(arguments):
    requested = json.loads(arguments)
    return {
        "city": requested["city"],
        "condition": "light rain",
        "humidity_percent": 78,
        "source": "dummy weather function",
        "temperature": 27 if requested["unit"] == "celsius" else 81,
        "unit": requested["unit"],
    }


def request_weather(client, model, messages):
    completion = client.chat.completions.create(
        model=model,
        messages=messages,
        tools=[WEATHER_TOOL],
        tool_choice={"type": "function", "function": {"name": "get_weather"}},
    )
    message = completion.choices[0].message
    if not message.tool_calls:
        raise RuntimeError("turn 1 did not return the required weather tool call")
    messages.append(message.model_dump(exclude_none=True))
    return completion, message.tool_calls[0]


def submit_weather_result(client, model, messages, tool_call):
    result = dummy_weather(tool_call.function.arguments)
    print(f"\nDummy tool output: {json.dumps(result, indent=2)}")
    messages.append(
        {
            "role": "tool",
            "tool_call_id": tool_call.id,
            "content": json.dumps(result),
        }
    )
    completion = client.chat.completions.create(model=model, messages=messages)
    messages.append(completion.choices[0].message.model_dump(exclude_none=True))
    return completion


def ask_follow_up(client, model, messages):
    messages.append(
        {
            "role": "user",
            "content": "Based on that weather, should I carry an umbrella? Answer briefly. and finnally, what's your name?",
        }
    )
    return client.chat.completions.create(model=model, messages=messages)


def run_conversation(client, args):
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {
            "role": "user",
            "content": "What is the weather in Pune? Use the weather tool with celsius.",
        },
    ]
    first, tool_call = request_weather(client, args.model, messages)
    print_completion(1, "assistant requests the weather tool", first)
    second = submit_weather_result(client, args.model, messages, tool_call)
    require_system_prompt(second)
    print_completion(2, "assistant reads the dummy tool result", second)
    third = ask_follow_up(client, args.model, messages)
    require_system_prompt(third)
    print_completion(3, "assistant answers a follow-up", third)


def main():
    args = parse_args()
    print(f"proxy: {args.base_url}")
    print(f"model: {args.model}")
    print(f"conversation key: {args.session_id}")
    try:
        with create_client(args) as client:
            run_conversation(client, args)
    except (RuntimeError, KeyError, json.JSONDecodeError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    print("\nExpected proxy log: cold, resumed, resumed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
