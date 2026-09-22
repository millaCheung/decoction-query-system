import 'dotenv/config';
import express, { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import cron from 'node-cron';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';

const prisma = new PrismaClient();
const app = express();
const port = Number(process.env.PORT || 3001);
const jwtSecret = process.env.JWT_SECRET || 'dev-only-secret-change-in-production';
const statusFlow: Record<string, string[]> = {
  WAITING: ['COOKING', 'PAUSED', 'CANCELLED'],
  COOKING: ['FINISHED', 'PAUSED', 'CANCELLED'],
  PAUSED: ['WAITING', 'COOKING', 'CANCELLED'],
  FINISHED: ['PICKED_UP'], PICKED_UP: [], CANCELLED: []
};

declare global { namespace Express { interface Request { user?: { id: number; role: string; name: string } } } }

app.set('trust proxy', 1);
app.use(helmet());
app.use(cors({ origin: process.env.ADMIN_ORIGIN?.split(',') || true }));
app.use(express.json({ limit: '50kb' }));

const asyncRoute = (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => void fn(req, res, next).catch(next);

function auth(req: Request, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ message: '请先登录' });
  try { req.user = jwt.verify(token, jwtSecret) as typeof req.user; next(); }
  catch { res.status(401).json({ message: '登录已失效，请重新登录' }); }
}

function maskName(name: string) { return name.length <= 1 ? `${name}*` : `${name[0]}${'*'.repeat(Math.min(2, name.length - 1))}`; }
function maskPhone(phone: string) { return phone.replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2'); }
function orderNo() { const d = new Date(); return `DQ${d.toISOString().slice(0,10).replaceAll('-','')}${String(Date.now()).slice(-6)}`; }
async function audit(req: Request, action: string, targetId?: string, detail?: unknown) {
  await prisma.operationLog.create({ data: { userId: req.user?.id, action, targetId, ip: req.ip, detail: detail ? JSON.stringify(detail) : undefined } });
}

app.get('/api/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.post('/api/admin/login', rateLimit({ windowMs: 15 * 60000, limit: 10 }), asyncRoute(async (req, res) => {
  const body = z.object({ username: z.string().min(1), password: z.string().min(6) }).parse(req.body);
  const user = await prisma.user.findUnique({ where: { username: body.username } });
  if (!user || user.status !== 'ACTIVE' || !(await bcrypt.compare(body.password, user.passwordHash))) return res.status(401).json({ message: '账号或密码错误' });
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  const token = jwt.sign({ id: user.id, role: user.role, name: user.name }, jwtSecret, { expiresIn: '8h' });
  res.json({ token, user: { id: user.id, name: user.name, role: user.role } });
}));

app.get('/api/admin/dashboard', auth, asyncRoute(async (_req, res) => {
  const start = new Date(); start.setHours(0,0,0,0);
  const grouped = await prisma.decoctionOrder.groupBy({ by: ['status'], where: { registeredAt: { gte: start } }, _count: true });
  const stats: Record<string, number> = { TOTAL: 0, WAITING: 0, COOKING: 0, FINISHED: 0, PICKED_UP: 0, PAUSED: 0, CANCELLED: 0 };
  grouped.forEach(x => { stats[x.status] = x._count; stats.TOTAL += x._count; });
  res.json(stats);
}));

app.get('/api/admin/orders', auth, asyncRoute(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1), pageSize = Math.min(100, Number(req.query.pageSize) || 20);
  const keyword = String(req.query.keyword || '').trim(), status = String(req.query.status || '').trim();
  const where = { ...(status ? { status } : {}), ...(keyword ? { OR: [{ patientName: { contains: keyword } }, { phone: { contains: keyword } }, { orderNo: { contains: keyword } }] } : {}) };
  const [items, total] = await Promise.all([
    prisma.decoctionOrder.findMany({ where, orderBy: { registeredAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize, include: { createdBy: { select: { name: true } } } }),
    prisma.decoctionOrder.count({ where })
  ]);
  res.json({ items, total, page, pageSize });
}));

app.post('/api/admin/orders', auth, asyncRoute(async (req, res) => {
  const body = z.object({ patientName: z.string().trim().min(1).max(30), phone: z.string().regex(/^1\d{10}$/), remark: z.string().max(200).optional().default('') }).parse(req.body);
  const now = new Date();
  const order = await prisma.$transaction(async tx => {
    const created = await tx.decoctionOrder.create({ data: { ...body, orderNo: orderNo(), status: 'WAITING', registeredAt: now, expireAt: new Date(now.getTime() + 30 * 86400000), createdById: req.user!.id } });
    await tx.statusLog.create({ data: { orderId: created.id, oldStatus: null, newStatus: 'WAITING', operatorId: req.user!.id } });
    return created;
  });
  await audit(req, 'ORDER_CREATE', String(order.id), { orderNo: order.orderNo });
  res.status(201).json(order);
}));

app.get('/api/admin/orders/:id', auth, asyncRoute(async (req, res) => {
  const order = await prisma.decoctionOrder.findUnique({ where: { id: Number(req.params.id) }, include: { statusLogs: { orderBy: { createdAt: 'asc' }, include: { operator: { select: { name: true } } } }, createdBy: { select: { name: true } } } });
  if (!order) return res.status(404).json({ message: '任务不存在' });
  res.json(order);
}));

app.patch('/api/admin/orders/:id/status', auth, asyncRoute(async (req, res) => {
  const { status } = z.object({ status: z.enum(['WAITING','COOKING','FINISHED','PICKED_UP','PAUSED','CANCELLED']) }).parse(req.body);
  const id = Number(req.params.id), current = await prisma.decoctionOrder.findUnique({ where: { id } });
  if (!current) return res.status(404).json({ message: '任务不存在' });
  if (!statusFlow[current.status]?.includes(status)) return res.status(409).json({ message: `不能从${current.status}变更为${status}` });
  const now = new Date();
  const data: Record<string, unknown> = { status };
  if (status === 'COOKING' && !current.startTime) data.startTime = now;
  if (status === 'FINISHED') data.finishTime = now;
  if (status === 'PICKED_UP') data.pickupTime = now;
  const updated = await prisma.$transaction(async tx => {
    const row = await tx.decoctionOrder.update({ where: { id }, data });
    await tx.statusLog.create({ data: { orderId: id, oldStatus: current.status, newStatus: status, operatorId: req.user!.id } });
    return row;
  });
  await audit(req, 'ORDER_STATUS_CHANGE', String(id), { from: current.status, to: status });
  res.json(updated);
}));

app.get('/api/admin/users', auth, asyncRoute(async (req, res) => {
  if (req.user!.role !== 'ADMIN') return res.status(403).json({ message: '无管理员权限' });
  res.json(await prisma.user.findMany({ select: { id: true, username: true, name: true, role: true, status: true, createdAt: true, lastLoginAt: true }, orderBy: { id: 'asc' } }));
}));

app.post('/api/admin/users', auth, asyncRoute(async (req, res) => {
  if (req.user!.role !== 'ADMIN') return res.status(403).json({ message: '无管理员权限' });
  const body = z.object({ username: z.string().regex(/^[a-zA-Z0-9_]{3,30}$/), name: z.string().min(1).max(30), password: z.string().min(8).max(72), role: z.enum(['ADMIN','STAFF']).default('STAFF') }).parse(req.body);
  const passwordHash = await bcrypt.hash(body.password, 12);
  const user = await prisma.user.create({ data: { ...body, password: undefined, passwordHash } as never });
  await audit(req, 'USER_CREATE', String(user.id), { username: user.username, role: user.role });
  res.status(201).json({ id: user.id, username: user.username, name: user.name, role: user.role });
}));

app.patch('/api/admin/users/:id/status', auth, asyncRoute(async (req, res) => {
  if (req.user!.role !== 'ADMIN') return res.status(403).json({ message: '无管理员权限' });
  const { status } = z.object({ status: z.enum(['ACTIVE','DISABLED']) }).parse(req.body);
  if (Number(req.params.id) === req.user!.id && status === 'DISABLED') return res.status(400).json({ message: '不能禁用当前账号' });
  const user = await prisma.user.update({ where: { id: Number(req.params.id) }, data: { status } });
  await audit(req, 'USER_STATUS_CHANGE', String(user.id), { status });
  res.json({ id: user.id, status: user.status });
}));

app.post('/api/public/decoction/query', rateLimit({ windowMs: 10 * 60000, limit: 20, standardHeaders: true, legacyHeaders: false }), asyncRoute(async (req, res) => {
  const { phone } = z.object({ phone: z.string().regex(/^1\d{10}$/) }).parse(req.body);
  const rows = await prisma.decoctionOrder.findMany({ where: { phone, expireAt: { gt: new Date() }, status: { not: 'CANCELLED' } }, orderBy: { registeredAt: 'desc' }, take: 10 });
  res.json({ records: rows.map(({ id, patientName, phone: p, remark, createdById, ...x }) => ({ ...x, id: undefined, patientName: maskName(patientName), phone: maskPhone(p), remark: undefined, createdById: undefined })) });
}));

cron.schedule('0 2 * * *', async () => {
  const result = await prisma.decoctionOrder.deleteMany({ where: { expireAt: { lt: new Date() } } });
  await prisma.operationLog.create({ data: { action: 'AUTO_CLEANUP', detail: JSON.stringify({ count: result.count }) } });
}, { timezone: 'Asia/Shanghai' });

app.use((_req, res) => res.status(404).json({ message: '接口不存在' }));
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  if (err instanceof z.ZodError) return res.status(400).json({ message: '输入信息有误', errors: err.issues });
  if ((err as { code?: string }).code === 'P2002') return res.status(409).json({ message: '该账号或编号已存在' });
  res.status(500).json({ message: '服务暂时不可用' });
});

app.listen(port, () => console.log(`Decoction API running at http://localhost:${port}`));
