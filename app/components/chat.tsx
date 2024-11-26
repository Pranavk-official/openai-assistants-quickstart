"use client";

import React, { useState, useEffect, useRef } from "react";
import styles from "./chat.module.css";
import { AssistantStream } from "openai/lib/AssistantStream";
import Markdown from "react-markdown";
// @ts-expect-error - no types for this yet
import { AssistantStreamEvent } from "openai/resources/beta/assistants/assistants";
import { RequiredActionFunctionToolCall } from "openai/resources/beta/threads/runs/runs";

type MessageProps = {
  role: "user" | "assistant" | "code";
  text: string;
};

const UserMessage = ({ text }: { text: string }) => {
  return <div className={styles.userMessage}>{text}</div>;
};

const AssistantMessage = ({ text }: { text: string }) => {
  return (
    <div className={styles.assistantMessage}>
      <Markdown>{text}</Markdown>
    </div>
  );
};

const CodeMessage = ({ text }: { text: string }) => {
  return (
    <div className={styles.codeMessage}>
      {text.split("\n").map((line, index) => (
        <div key={index}>
          <span>{`${index + 1}. `}</span>
          {line}
        </div>
      ))}
    </div>
  );
};

const Message = ({ role, text }: MessageProps) => {
  switch (role) {
    case "user":
      return <UserMessage text={text} />;
    case "assistant":
      return <AssistantMessage text={text} />;
    case "code":
      return <CodeMessage text={text} />;
    default:
      return null;
  }
};

type ChatProps = {
  functionCallHandler?: (
    toolCall: RequiredActionFunctionToolCall
  ) => Promise<string>;
};

const Chat = ({
  functionCallHandler = () => Promise.resolve(""), // default to return empty string
}: ChatProps) => {
  const [messages, setMessages] = useState<MessageProps[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [studentName, setStudentName] = useState("");
  const [threadId, setThreadId] = useState<string | null>(null);
  const messagesEndRef = useRef<null | HTMLDivElement>(null);
  const [inputDisabled, setInputDisabled] = useState(false);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleStudentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!studentName.trim()) return;
  
    setIsLoading(true);
    try {
      const response = await fetch('/api/students', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ studentName: studentName.trim() })
      });
  
      const data = await response.json();
      if (data.threadId) {
        setThreadId(data.threadId);
        
        // If returning student, show previous messages
        if (!data.isNewStudent && data.messages.length > 0) {
          setMessages(data.messages);
        } else {
          // If new student, show welcome message
          setMessages([{
            role: "assistant",
            text: `Hello ${studentName}! How can I help you today?`
          }]);
        }
      }
    } catch (error) {
      console.error('Error:', error);
      setMessages([{
        role: "assistant",
        text: "Sorry, there was an error starting the chat. Please try again."
      }]);
    }
    setIsLoading(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !threadId) return;

    const userMessage = input.trim();
    setInput("");
    setMessages((messages) => [...messages, { role: "user", text: userMessage }]);
    setIsLoading(true);

    const response = await fetch(
      `/api/assistants/threads/${threadId}/messages`,
      {
        method: "POST",
        body: JSON.stringify({
          content: userMessage,
        }),
      }
    );
    const stream = AssistantStream.fromReadableStream(response.body);
    handleReadableStream(stream);
  };

  const handleReadableStream = (stream: AssistantStream) => {
    // messages
    stream.on("textCreated", handleTextCreated);
    stream.on("textDelta", handleTextDelta);

    // image
    stream.on("imageFileDone", handleImageFileDone);

    // code interpreter
    stream.on("toolCallCreated", toolCallCreated);
    stream.on("toolCallDelta", toolCallDelta);

    // events without helpers yet (e.g. requires_action and run.done)
    stream.on("event", (event) => {
      if (event.event === "thread.run.requires_action")
        handleRequiresAction(event);
      if (event.event === "thread.run.completed") handleRunCompleted();
    });
  };

  const handleTextCreated = () => {
    appendMessage("assistant", "");
  };

  const handleTextDelta = (delta) => {
    if (delta.value != null) {
      appendToLastMessage(delta.value);
    };
    if (delta.annotations != null) {
      annotateLastMessage(delta.annotations);
    }
  };

  const handleImageFileDone = (image) => {
    appendToLastMessage(`\n![${image.file_id}](/api/files/${image.file_id})\n`);
  }

  const toolCallCreated = (toolCall) => {
    if (toolCall.type != "code_interpreter") return;
    appendMessage("code", "");
  };

  const toolCallDelta = (delta, snapshot) => {
    if (delta.type != "code_interpreter") return;
    if (!delta.code_interpreter.input) return;
    appendToLastMessage(delta.code_interpreter.input);
  };

  const handleRequiresAction = async (
    event: AssistantStreamEvent.ThreadRunRequiresAction
  ) => {
    const runId = event.data.id;
    const toolCalls = event.data.required_action.submit_tool_outputs.tool_calls;
    // loop over tool calls and call function handler
    const toolCallOutputs = await Promise.all(
      toolCalls.map(async (toolCall) => {
        const result = await functionCallHandler(toolCall);
        return { output: result, tool_call_id: toolCall.id };
      })
    );
    setInputDisabled(true);
    submitActionResult(runId, toolCallOutputs);
  };

  const handleRunCompleted = () => {
    setInputDisabled(false);
  };

  const appendToLastMessage = (text) => {
    setMessages((prevMessages) => {
      const lastMessage = prevMessages[prevMessages.length - 1];
      const updatedLastMessage = {
        ...lastMessage,
        text: lastMessage.text + text,
      };
      return [...prevMessages.slice(0, -1), updatedLastMessage];
    });
  };

  const appendMessage = (role, text) => {
    setMessages((prevMessages) => [...prevMessages, { role, text }]);
  };

  const annotateLastMessage = (annotations) => {
    setMessages((prevMessages) => {
      const lastMessage = prevMessages[prevMessages.length - 1];
      const updatedLastMessage = {
        ...lastMessage,
      };
      annotations.forEach((annotation) => {
        if (annotation.type === 'file_path') {
          updatedLastMessage.text = updatedLastMessage.text.replaceAll(
            annotation.text,
            `/api/files/${annotation.file_path.file_id}`
          );
        }
      })
      return [...prevMessages.slice(0, -1), updatedLastMessage];
    });
    
  }

  const submitActionResult = async (runId, toolCallOutputs) => {
    const response = await fetch(
      `/api/assistants/threads/${threadId}/actions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          runId: runId,
          toolCallOutputs: toolCallOutputs,
        }),
      }
    );
    const stream = AssistantStream.fromReadableStream(response.body);
    handleReadableStream(stream);
  };

  if (!threadId) {
    return (
      <div className={styles.chat}>
        <form onSubmit={handleStudentSubmit} className={styles.inputForm}>
          <input
            className={styles.input}
            value={studentName}
            onChange={(e) => setStudentName(e.target.value)}
            placeholder="Enter your name to start chatting..."
            disabled={isLoading}
          />
          <button type="submit" disabled={isLoading || !studentName.trim()} className={styles.button}>
            {isLoading ? "Starting..." : "Start Chat"}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className={styles.chat}>
      <div className={styles.messages}>
        {messages.map((message, index) => (
          <Message key={index} {...message} />
        ))}
        <div ref={messagesEndRef} />
      </div>
      <form onSubmit={handleSubmit} className={styles.inputForm}>
        <input
          className={styles.input}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type your message..."
          disabled={isLoading}
        />
        <button type="submit" disabled={isLoading || !input.trim()} className={styles.button}>
          {isLoading ? "Sending..." : "Send"}
        </button>
      </form>
    </div>
  );
};

export default Chat;
