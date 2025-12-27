const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const prisma = new PrismaClient();

async function main() {
    const username = process.argv[2] || 'admin';
    const password = process.argv[3] || 'admin123';

    console.log(`Creating admin user: ${username}...`);

    const hashedPassword = await bcrypt.hash(password, 10);

    try {
        const admin = await prisma.admin.upsert({
            where: { username },
            update: {
                password: hashedPassword,
                status: 'approved'
            },
            create: {
                username,
                password: hashedPassword,
                status: 'approved'
            },
        });
        console.log(`Admin user ${admin.username} created successfully!`);
    } catch (e) {
        console.error('Error creating admin:', e);
    } finally {
        await prisma.$disconnect();
    }
}

main();
