import { openai } from "@/app/openai";
import { PrismaClient } from '@prisma/client';
import { NextResponse } from 'next/server';

const prisma = new PrismaClient();

export const runtime = "nodejs";

// Create or get student thread
export async function POST(request: Request) {
  try {
    const { studentName } = await request.json();

    if (!studentName) {
      return NextResponse.json({ error: 'Student name is required' }, { status: 400 });
    }

    // Check if student exists
    let student = await prisma.student.findUnique({
      where: { name: studentName },
      include: { thread: true }
    });

    if (!student) {
      // Create a new thread
      const thread = await openai.beta.threads.create();
      
      // Create new student with thread
      student = await prisma.student.create({
        data: {
          name: studentName,
          thread: {
            create: {
              threadId: thread.id
            }
          }
        },
        include: { thread: true }
      });

      return NextResponse.json({
        threadId: student.thread.threadId,
        isNewStudent: true,
        messages: []
      });
    }

    // Fetch previous messages for existing student
    const messages = await openai.beta.threads.messages.list(
      student.thread.threadId
    );

    // Format messages for the frontend
    const formattedMessages = messages.data.map(msg => ({
      role: msg.role,
      text: msg.content[0].text.value
    })).reverse(); // Reverse to show oldest messages first

    // Return existing thread ID with messages
    return NextResponse.json({
      threadId: student.thread.threadId,
      isNewStudent: false,
      messages: formattedMessages
    });

  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json(
      { error: 'Failed to process student request' },
      { status: 500 }
    );
  }
}