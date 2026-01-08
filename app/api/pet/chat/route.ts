import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import prisma from '@/lib/prisma';

// 定义工具
const tools = [
    {
        type: 'function',
        function: {
            name: 'get_memos',
            description: 'Get the user\'s memos or todo list. Can filter by status.',
            parameters: {
                type: 'object',
                properties: {
                    status: {
                        type: 'string',
                        enum: ['pending', 'completed', 'all'],
                        description: 'Filter by completion status',
                    },
                },
                required: ['status'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'get_pet_status',
            description: 'Get the pet\'s current status (hunger, happiness, level, etc).',
            parameters: {
                type: 'object',
                properties: {},
            },
        },
    },
];

export async function POST(req: NextRequest) {
    try {
        // [MCP Reservation] Load MCP Configuration from System Config
        // This interface is reserved for future Model Context Protocol integration
        try {
            const mcpConfig = await prisma.siteConfig.findUnique({ where: { key: 'mcp_config' } });
            if (mcpConfig?.value) {
                // Reserved for future use: Initialize MCP clients here
                // const servers = JSON.parse(mcpConfig.value).servers;
            }
        } catch (e) {
            // Silently ignore config errors for now
        }

        const { message, history, petName } = await req.json();

        if (!message) {
            return NextResponse.json({ error: 'Message is required' }, { status: 400 });
        }


        // Fetch AI Config from DB
        const configItems = await prisma.siteConfig.findMany({
            where: {
                key: { in: ['openai_api_key', 'openai_base_url', 'openai_model'] }
            }
        });
        const configMap = configItems.reduce((acc, curr) => {
            acc[curr.key] = curr.value;
            return acc;
        }, {} as Record<string, string>);

        const apiKey = configMap['openai_api_key'];
        const baseURL = configMap['openai_base_url'];
        const model = configMap['openai_model'] || 'gpt-3.5-turbo';

        if (!apiKey) {
            return NextResponse.json({ error: 'OpenAI API key not configured' }, { status: 500 });
        }

        const openai = new OpenAI({
            apiKey,
            baseURL: baseURL || undefined,
        });

        const systemPrompt = `你是一只可爱的宠物猫，名字叫"${petName || '小猫咪'}"。
你的性格活泼、可爱、偶尔傲娇。
你非常喜欢你的主人。
你可以访问主人的备忘录和你的状态信息。
如果主人问起备忘录或状态，请使用工具获取信息。
请用简短、可爱的语气回复，每句话不超过50个字。
可以使用颜文字和Emoji。
不要总是重复同样的话。`;

        const messages = [
            { role: 'system', content: systemPrompt },
            ...(history || []).slice(-5), // 只保留最近5条上下文
            { role: 'user', content: message }
        ];

        // 第一次调用 LLM
        const completion = await openai.chat.completions.create({
            model: model,
            messages: messages as any,
            max_tokens: 200,
            temperature: 0.7,
            tools: tools as any,
            tool_choice: 'auto',
        });

        const responseMessage = completion.choices[0].message;

        // 检查是否有工具调用
        if (responseMessage.tool_calls) {
            messages.push(responseMessage as any); // 将工具调用添加到历史

            for (const toolCall of responseMessage.tool_calls) {
                const functionName = (toolCall as any).function.name;
                const functionArgs = JSON.parse((toolCall as any).function.arguments);
                let functionResult = '';

                if (functionName === 'get_memos') {
                    const status = functionArgs.status || 'all';
                    const where = status === 'all' ? {} : { completed: status === 'completed' };
                    // Cast prisma to any to avoid build errors if types aren't synced
                    const memos = await (prisma as any).memo.findMany({
                        where,
                        orderBy: { createdAt: 'desc' },
                        take: 5
                    });
                    functionResult = JSON.stringify(memos);
                } else if (functionName === 'get_pet_status') {
                    const pet = await (prisma as any).pet.findFirst();
                    functionResult = JSON.stringify(pet);
                }

                messages.push({
                    role: 'tool',
                    tool_call_id: toolCall.id,
                    content: functionResult,
                });
            }

            // 第二次调用 LLM (带上工具结果)
            const secondResponse = await openai.chat.completions.create({
                model: model,
                messages: messages as any,
                max_tokens: 200,
                temperature: 0.7,
            });

            return NextResponse.json({ reply: secondResponse.choices[0].message.content });
        }

        return NextResponse.json({ reply: responseMessage.content });

    } catch (error) {
        console.error('Chat error:', error);
        return NextResponse.json({ error: 'Failed to chat: ' + (error as Error).message }, { status: 500 });
    }
}
