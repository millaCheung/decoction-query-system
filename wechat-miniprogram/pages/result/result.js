const { apiBaseUrl } = require('../../config');
const statusMeta={WAITING:{label:'等待煎制',tip:'药材已登记，请耐心等待',step:1},COOKING:{label:'正在煎制',tip:'药师正在用心为您煎制',step:2},FINISHED:{label:'煎制完成',tip:'您的药已完成，请前往药房领取',step:3},PICKED_UP:{label:'已领取',tip:'本次煎药服务已完成',step:3},PAUSED:{label:'暂缓处理',tip:'任务暂缓，请联系药房了解详情',step:1}};
Page({
  data:{loading:true,records:[],current:0,statusMeta},
  onLoad(){this.fetch();},
  fetch(){const phone=getApp().globalData.phone;if(!phone)return wx.navigateBack();this.setData({loading:true});wx.request({url:`${apiBaseUrl}/public/decoction/query`,method:'POST',data:{phone},success:r=>{if(r.statusCode===200)this.setData({records:r.data.records||[]});else wx.showToast({title:r.data.message||'查询失败',icon:'none'});},fail:()=>wx.showToast({title:'网络连接失败',icon:'none'}),complete:()=>this.setData({loading:false})});},
  switchRecord(e){this.setData({current:Number(e.currentTarget.dataset.index)});},
  fmt(v){if(!v)return '--';const d=new Date(v);return `${d.getMonth()+1}月${d.getDate()}日 ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;}
});
