Page({
  data: { phone: '', loading: false, canSubmit: false },
  onInput(e) { const phone=e.detail.value.replace(/\D/g,'').slice(0,11); this.setData({phone,canSubmit:/^1\d{10}$/.test(phone)}); },
  query() {
    if (!this.data.canSubmit || this.data.loading) return;
    getApp().globalData.phone=this.data.phone;
    wx.navigateTo({url:'/pages/result/result'});
  }
});
