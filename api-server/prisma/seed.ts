import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();
const now = new Date();

async function main() {
  const passwordHash = await bcrypt.hash('Admin@123456', 12);
  const admin = await prisma.user.upsert({
    where: { username: 'admin' },
    update: {},
    create: { username: 'admin', passwordHash, name: '系统管理员', role: 'ADMIN' }
  });
  if (await prisma.decoctionOrder.count()) return;
  const samples = [
    ['DQ202609230001', '张建国', '13812345678', 'WAITING', -12],
    ['DQ202609230002', '李晓梅', '15612345678', 'COOKING', -48],
    ['DQ202609230003', '王秀兰', '18912345678', 'FINISHED', -95],
    ['DQ202609230004', '赵志强', '13712345678', 'PICKED_UP', -160]
  ] as const;
  for (const [orderNo, patientName, phone, status, mins] of samples) {
    const registeredAt = new Date(now.getTime() + mins * 60000);
    const startTime = status !== 'WAITING' ? new Date(registeredAt.getTime() + 20 * 60000) : null;
    const finishTime = ['FINISHED', 'PICKED_UP'].includes(status) ? new Date(registeredAt.getTime() + 75 * 60000) : null;
    const pickupTime = status === 'PICKED_UP' ? new Date(registeredAt.getTime() + 110 * 60000) : null;
    const order = await prisma.decoctionOrder.create({ data: {
      orderNo, patientName, phone, status, registeredAt, startTime, finishTime, pickupTime,
      expireAt: new Date(registeredAt.getTime() + 30 * 86400000), createdById: admin.id
    }});
    await prisma.statusLog.create({ data: { orderId: order.id, oldStatus: null, newStatus: 'WAITING', operatorId: admin.id, createdAt: registeredAt }});
    if (startTime) await prisma.statusLog.create({ data: { orderId: order.id, oldStatus: 'WAITING', newStatus: 'COOKING', operatorId: admin.id, createdAt: startTime }});
    if (finishTime) await prisma.statusLog.create({ data: { orderId: order.id, oldStatus: 'COOKING', newStatus: 'FINISHED', operatorId: admin.id, createdAt: finishTime }});
    if (pickupTime) await prisma.statusLog.create({ data: { orderId: order.id, oldStatus: 'FINISHED', newStatus: 'PICKED_UP', operatorId: admin.id, createdAt: pickupTime }});
  }
}

main().finally(() => prisma.$disconnect());
