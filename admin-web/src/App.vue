<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { api } from './api';
import dayjs from 'dayjs';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Plus, Search, Refresh, User, SwitchButton, DataBoard, Tickets, UserFilled, Lock, Phone, ArrowRight } from '@element-plus/icons-vue';

type Status = 'WAITING'|'COOKING'|'FINISHED'|'PICKED_UP'|'PAUSED'|'CANCELLED';
type Order = { id:number; orderNo:string; patientName:string; phone:string; status:Status; registeredAt:string; startTime?:string; finishTime?:string; pickupTime?:string; remark?:string; createdBy:{name:string} };
const statusMeta: Record<Status, {label:string; type:string; next?:Status; action?:string}> = {
  WAITING:{label:'待煎制',type:'warning',next:'COOKING',action:'开始煎制'}, COOKING:{label:'煎制中',type:'primary',next:'FINISHED',action:'完成煎制'},
  FINISHED:{label:'已完成',type:'success',next:'PICKED_UP',action:'确认领取'}, PICKED_UP:{label:'已领取',type:'info'}, PAUSED:{label:'已暂停',type:'danger'}, CANCELLED:{label:'已取消',type:'info'}
};
const token = ref(localStorage.getItem('decoction_token') || '');
const currentUser = ref(JSON.parse(localStorage.getItem('decoction_user') || 'null'));
const login = reactive({ username:'admin', password:'Admin@123456' });
const logging = ref(false), loading = ref(false), saving = ref(false);
const orders = ref<Order[]>([]), total = ref(0), page = ref(1), pageSize = ref(20);
const query = reactive({ keyword:'', status:'' });
const stats = reactive({ TOTAL:0, WAITING:0, COOKING:0, FINISHED:0, PICKED_UP:0 });
const addVisible = ref(false), detailVisible = ref(false), selected = ref<any>(null);
const form = reactive({ patientName:'', phone:'', remark:'' });

const greeting = computed(() => { const h=new Date().getHours(); return h<11?'上午好':h<14?'中午好':h<18?'下午好':'晚上好'; });
function fmt(v?:string){ return v ? dayjs(v).format('MM-DD HH:mm') : '—'; }
function meta(v: Status | string): {label:string; type:string; next?:Status; action?:string} { return statusMeta[v as Status] || { label: v, type: 'info' }; }
function maskPhone(v:string){ return v.replace(/^(\d{3})\d{4}(\d{4})$/,'$1 **** $2'); }
function errMsg(e:any){ return e.response?.data?.message || '操作失败，请稍后重试'; }
async function doLogin(){ logging.value=true; try { const {data}=await api.post('/admin/login',login); token.value=data.token; currentUser.value=data.user; localStorage.setItem('decoction_token',data.token); localStorage.setItem('decoction_user',JSON.stringify(data.user)); await refresh(); } catch(e){ ElMessage.error(errMsg(e)); } finally{logging.value=false;} }
function logout(){ localStorage.clear(); token.value=''; currentUser.value=null; }
async function loadOrders(){ loading.value=true; try { const {data}=await api.get('/admin/orders',{params:{...query,page:page.value,pageSize:pageSize.value}}); orders.value=data.items; total.value=data.total; } catch(e){ElMessage.error(errMsg(e));} finally{loading.value=false;} }
async function loadStats(){ Object.assign(stats,(await api.get('/admin/dashboard')).data); }
async function refresh(){ await Promise.all([loadOrders(),loadStats()]); }
async function createOrder(andNext=false){ if(!form.patientName.trim()||!/^1\d{10}$/.test(form.phone)) return ElMessage.warning('请填写姓名和正确的 11 位手机号'); saving.value=true; try { await api.post('/admin/orders',form); ElMessage.success('煎药任务已登记'); Object.assign(form,{patientName:'',phone:'',remark:''}); if(!andNext)addVisible.value=false; await refresh(); } catch(e){ElMessage.error(errMsg(e));} finally{saving.value=false;} }
async function changeStatus(row:Order,status:Status){ try { await ElMessageBox.confirm(`确认将“${row.patientName}”更新为“${statusMeta[status].label}”吗？`,'状态确认',{type:'warning'}); await api.patch(`/admin/orders/${row.id}/status`,{status}); ElMessage.success('状态已更新'); await refresh(); } catch(e:any){ if(e!=='cancel'&&e!=='close')ElMessage.error(errMsg(e)); } }
async function openDetail(row:Order){ try { selected.value=(await api.get(`/admin/orders/${row.id}`)).data; detailVisible.value=true; } catch(e){ElMessage.error(errMsg(e));} }
onMounted(()=>{if(token.value)refresh();});
</script>

<template>
  <div v-if="!token" class="login-page">
    <div class="login-brand"><div class="brand-mark">安</div><h1>安心煎药</h1><p>让每一份等待，都清晰可见</p><div class="brand-art"><span></span><span></span><span></span></div></div>
    <div class="login-panel"><div class="login-card"><div class="mobile-logo"><b>安</b> 安心煎药</div><p class="eyebrow">PHARMACY WORKSPACE</p><h2>欢迎回来</h2><p class="muted">登录药房工作台，开始今天的煎药任务</p>
      <el-form @submit.prevent="doLogin"><label>账号</label><el-input v-model="login.username" size="large" :prefix-icon="User" placeholder="请输入账号"/><label>密码</label><el-input v-model="login.password" size="large" :prefix-icon="Lock" type="password" show-password placeholder="请输入密码" @keyup.enter="doLogin"/><el-button class="login-btn" type="primary" size="large" :loading="logging" @click="doLogin">登录工作台 <el-icon><ArrowRight/></el-icon></el-button></el-form>
      <div class="security-note">系统仅限授权工作人员使用 · 操作全程留痕</div></div></div>
  </div>
  <div v-else class="app-shell">
    <aside><div class="logo"><b>安</b><div><strong>安心煎药</strong><small>药房工作台</small></div></div><nav><a class="active"><el-icon><DataBoard/></el-icon>工作概览</a><a><el-icon><Tickets/></el-icon>煎药任务</a><a v-if="currentUser?.role==='ADMIN'"><el-icon><UserFilled/></el-icon>账号管理</a></nav><div class="aside-bottom"><div class="avatar">{{currentUser?.name?.slice(0,1)}}</div><div><strong>{{currentUser?.name}}</strong><small>{{currentUser?.role==='ADMIN'?'系统管理员':'药房工作人员'}}</small></div><el-button link :icon="SwitchButton" @click="logout" /></div></aside>
    <main><header><div><p>{{greeting}}，{{currentUser?.name}}</p><h1>今日煎药任务</h1></div><div class="date-chip">{{dayjs().format('YYYY 年 MM 月 DD 日')}}<span>实时更新</span></div></header>
      <section class="stats-grid"><div class="stat hero"><div><span>今日登记</span><strong>{{stats.TOTAL}}</strong><small>份煎药任务</small></div><div class="steam">♨</div></div><div class="stat"><i class="dot waiting"></i><span>等待煎制</span><strong>{{stats.WAITING}}</strong><small>请及时安排</small></div><div class="stat"><i class="dot cooking"></i><span>正在煎制</span><strong>{{stats.COOKING}}</strong><small>进行中</small></div><div class="stat"><i class="dot done"></i><span>今日完成</span><strong>{{stats.FINISHED}}</strong><small>待患者领取</small></div></section>
      <section class="task-card"><div class="card-head"><div><h2>任务列表</h2><p>快速更新每一份煎药进度</p></div><el-button type="primary" :icon="Plus" size="large" @click="addVisible=true">新增煎药</el-button></div>
        <div class="toolbar"><el-input v-model="query.keyword" :prefix-icon="Search" placeholder="搜索姓名、手机号或任务编号" clearable @keyup.enter="page=1;loadOrders()"/><el-select v-model="query.status" placeholder="全部状态" clearable @change="page=1;loadOrders()"><el-option v-for="(v,k) in statusMeta" :key="k" :label="v.label" :value="k"/></el-select><el-button :icon="Refresh" circle @click="refresh"/></div>
        <el-table :data="orders" v-loading="loading" class="order-table"><el-table-column label="患者" min-width="150"><template #default="{row}"><div class="patient"><span>{{row.patientName.slice(0,1)}}</span><div><strong>{{row.patientName}}</strong><small>{{maskPhone(row.phone)}}</small></div></div></template></el-table-column><el-table-column prop="orderNo" label="任务编号" min-width="160"/><el-table-column label="登记时间" min-width="120"><template #default="{row}">{{fmt(row.registeredAt)}}</template></el-table-column><el-table-column label="当前状态" min-width="105"><template #default="{row}"><el-tag :type="meta(row.status).type as any" effect="light" round><i class="tag-dot"></i>{{meta(row.status).label}}</el-tag></template></el-table-column><el-table-column label="进度时间" min-width="130"><template #default="{row}">{{fmt(row.finishTime||row.startTime)}}</template></el-table-column><el-table-column label="快捷操作" min-width="190" fixed="right"><template #default="{row}"><el-button v-if="meta(row.status).next" type="primary" plain @click="changeStatus(row,meta(row.status).next!)">{{meta(row.status).action}}</el-button><el-button link @click="openDetail(row)">详情</el-button></template></el-table-column></el-table>
        <div class="pagination"><span>共 {{total}} 条任务</span><el-pagination v-model:current-page="page" :page-size="pageSize" layout="prev, pager, next" :total="total" @change="loadOrders"/></div></section>
    </main>
    <el-dialog v-model="addVisible" title="登记新任务" width="480" class="form-dialog"><p class="dialog-tip">录入患者基础信息，保存后自动进入待煎队列</p><el-form label-position="top"><el-form-item label="患者姓名"><el-input v-model="form.patientName" size="large" placeholder="请输入患者姓名" maxlength="30"/></el-form-item><el-form-item label="手机号码"><el-input v-model="form.phone" size="large" :prefix-icon="Phone" placeholder="用于患者查询进度" maxlength="11"/></el-form-item><el-form-item label="备注（选填）"><el-input v-model="form.remark" type="textarea" :rows="3" placeholder="如：优先处理、代煎两剂" maxlength="200" show-word-limit/></el-form-item></el-form><template #footer><el-button @click="addVisible=false">取消</el-button><el-button :loading="saving" @click="createOrder(true)">保存并继续</el-button><el-button type="primary" :loading="saving" @click="createOrder(false)">保存任务</el-button></template></el-dialog>
    <el-drawer v-model="detailVisible" title="任务详情" size="430px"><template v-if="selected"><div class="detail-hero"><div class="patient large"><span>{{selected.patientName.slice(0,1)}}</span><div><strong>{{selected.patientName}}</strong><small>{{maskPhone(selected.phone)}} · {{selected.orderNo}}</small></div></div><el-tag :type="meta(selected.status).type as any" round>{{meta(selected.status).label}}</el-tag></div><h3>进度时间线</h3><el-timeline><el-timeline-item v-for="log in selected.statusLogs" :key="log.id" :timestamp="dayjs(log.createdAt).format('YYYY-MM-DD HH:mm')" placement="top" :type="log.newStatus==='FINISHED'?'success':'primary'"><b>{{meta(log.newStatus).label}}</b><p>操作人：{{log.operator.name}}</p></el-timeline-item></el-timeline></template></el-drawer>
  </div>
</template>
