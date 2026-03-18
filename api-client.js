// ============================================================
// api-client.js — Frontend API Client cho SneakerVN
// Phân biệt rõ:
//   - Khách vãn lai  : xem sản phẩm, đặt hàng không cần đăng nhập
//   - Khách đăng nhập: giỏ hàng riêng, lịch sử đơn, thông tin cá nhân
//   - Staff (admin/shop/accountant): dùng token staff riêng
// ============================================================

// ── Quản lý Token ────────────────────────────────────────────
const Auth = {
  // Lưu token khách hàng
  setCustomerToken(token, user) {
    sessionStorage.setItem('customer_token', token);
    sessionStorage.setItem('customer_user', JSON.stringify(user));
  },
  getCustomerToken() {
    return sessionStorage.getItem('customer_token');
  },
  getCustomerUser() {
    const u = sessionStorage.getItem('customer_user');
    return u ? JSON.parse(u) : null;
  },
  clearCustomer() {
    sessionStorage.removeItem('customer_token');
    sessionStorage.removeItem('customer_user');
  },

  // Lưu token staff (admin/shop/accountant)
  setStaffToken(token, user) {
    sessionStorage.setItem('staff_token', token);
    sessionStorage.setItem('staff_user', JSON.stringify(user));
  },
  getStaffToken() {
    return sessionStorage.getItem('staff_token');
  },
  getStaffUser() {
    const u = sessionStorage.getItem('staff_user');
    return u ? JSON.parse(u) : null;
  },
  clearStaff() {
    sessionStorage.removeItem('staff_token');
    sessionStorage.removeItem('staff_user');
  },

  // Kiểm tra trạng thái
  isCustomerLoggedIn() {
    return !!this.getCustomerToken();
  },
  isStaffLoggedIn() {
    return !!this.getStaffToken();
  },
  isLoggedIn() {
    return this.isCustomerLoggedIn() || this.isStaffLoggedIn();
  },

  // Đăng xuất tất cả
  logout() {
    this.clearCustomer();
    this.clearStaff();
  },
};

// ── API Client ───────────────────────────────────────────────
const API = {
  BASE: window.location.origin,

  // Build header: tự động chọn đúng token
  _headers(forStaff = false) {
    const token = forStaff ? Auth.getStaffToken() : Auth.getCustomerToken();
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return headers;
  },

  async _fetch(url, options = {}, forStaff = false) {
    const res = await fetch(url, {
      ...options,
      headers: { ...this._headers(forStaff), ...(options.headers || {}) },
    });
    const data = await res.json();
    if (res.status === 401) {
      // Token hết hạn → tự đăng xuất
      if (forStaff) Auth.clearStaff();
      else Auth.clearCustomer();
      throw new Error('Phiên đăng nhập hết hạn, vui lòng đăng nhập lại');
    }
    return data;
  },

  // ============================================================
  // XÁC THỰC KHÁCH HÀNG
  // ============================================================

  // Đăng ký tài khoản khách hàng
  async dangKy(hoTen, email, matKhau, soDienThoai = '', diaChi = '') {
    const data = await this._fetch(`${this.BASE}/api/auth/register`, {
      method: 'POST',
      body: JSON.stringify({
        HoTen: hoTen,
        Email: email,
        MatKhau: matKhau,
        SoDienThoai: soDienThoai,
        DiaChi: diaChi,
      }),
    });
    if (data.token) Auth.setCustomerToken(data.token, data.user);
    return data;
  },

  // Đăng nhập khách hàng — CHỈ gọi 1 lần, sau đó dùng token tự động
  async dangNhap(email, matKhau) {
    const data = await this._fetch(`${this.BASE}/api/auth/login`, {
      method: 'POST',
      body: JSON.stringify({ Email: email, MatKhau: matKhau }),
    });
    if (data.token) Auth.setCustomerToken(data.token, data.user);
    return data;
  },

  // Lấy thông tin khách hàng đang đăng nhập
  async getProfile() {
    return this._fetch(`${this.BASE}/api/auth/me`);
  },

  // Cập nhật thông tin cá nhân
  async updateProfile(hoTen, soDienThoai, diaChi) {
    return this._fetch(`${this.BASE}/api/auth/me`, {
      method: 'PUT',
      body: JSON.stringify({
        HoTen: hoTen,
        SoDienThoai: soDienThoai,
        DiaChi: diaChi,
      }),
    });
  },

  // Đăng xuất khách hàng
  dangXuat() {
    Auth.clearCustomer();
    updateNavForAuthState();
  },

  // ============================================================
  // XÁC THỰC STAFF
  // ============================================================

  async staffLogin(email, matKhau) {
    const data = await this._fetch(`${this.BASE}/api/admin/auth/login`, {
      method: 'POST',
      body: JSON.stringify({ Email: email, MatKhau: matKhau }),
    });
    if (data.token) Auth.setStaffToken(data.token, data.user);
    return data;
  },

  staffLogout() {
    Auth.clearStaff();
  },

  // ============================================================
  // SẢN PHẨM — công khai (không cần đăng nhập)
  // ============================================================

  async getSanPham(params = {}) {
    const q = new URLSearchParams(params).toString();
    return this._fetch(`${this.BASE}/api/sanpham?${q}`);
  },

  async getDanhMuc() {
    return this._fetch(`${this.BASE}/api/danhmuc`);
  },

  async getNhaCungCap() {
    return this._fetch(`${this.BASE}/api/nhacungcap`);
  },

  // ============================================================
  // GIỎ HÀNG — chỉ khách đăng nhập
  // ============================================================

  async getGioHang() {
    if (!Auth.isCustomerLoggedIn()) return [];
    return this._fetch(`${this.BASE}/api/giohang`);
  },

  async themVaoGio(maSanPham, soLuong = 1, size = '', mauSac = '') {
    if (!Auth.isCustomerLoggedIn())
      throw new Error('Vui lòng đăng nhập để thêm vào giỏ hàng');
    return this._fetch(`${this.BASE}/api/giohang`, {
      method: 'POST',
      body: JSON.stringify({
        MaSanPham: maSanPham,
        SoLuong: soLuong,
        Size: size,
        MauSac: mauSac,
      }),
    });
  },

  async capNhatGio(id, soLuong) {
    if (!Auth.isCustomerLoggedIn()) throw new Error('Chưa đăng nhập');
    return this._fetch(`${this.BASE}/api/giohang/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ SoLuong: soLuong }),
    });
  },

  async xoaKhoiGio(id) {
    if (!Auth.isCustomerLoggedIn()) throw new Error('Chưa đăng nhập');
    return this._fetch(`${this.BASE}/api/giohang/${id}`, { method: 'DELETE' });
  },

  // ============================================================
  // ĐẶT HÀNG
  // Khách đăng nhập: token tự động gắn CustomerID
  // Khách vãn lai: không cần token, truyền thông tin giao hàng
  // ============================================================

  async datHang(
    items,
    hoTenNguoiNhan,
    soDienThoaiNhan,
    diaChiGiao,
    ghiChu = '',
    phuongThucTT = 'Tiền mặt'
  ) {
    // Nếu đã đăng nhập → có thể lấy sẵn thông tin từ profile
    return this._fetch(`${this.BASE}/api/donhang`, {
      method: 'POST',
      body: JSON.stringify({
        items,
        HoTenNguoiNhan: hoTenNguoiNhan,
        SoDienThoaiNhan: soDienThoaiNhan,
        DiaChiGiao: diaChiGiao,
        GhiChu: ghiChu,
        PhuongThucTT: phuongThucTT,
      }),
    });
  },

  // Lịch sử đơn hàng — chỉ khách đăng nhập
  async getLichSuDonHang() {
    if (!Auth.isCustomerLoggedIn()) return [];
    return this._fetch(`${this.BASE}/api/donhang/cua-toi`);
  },

  // ============================================================
  // THANH TOÁN — công khai
  // ============================================================

  async initPayment(amount) {
    return this._fetch(`${this.BASE}/api/payment/init`, {
      method: 'POST',
      body: JSON.stringify({ amount }),
    });
  },

  async checkPayment(ref) {
    return this._fetch(`${this.BASE}/api/payment/check?ref=${ref}`);
  },

  async manualConfirm(ref, manualCode) {
    return this._fetch(`${this.BASE}/api/payment/manual-confirm`, {
      method: 'POST',
      body: JSON.stringify({ ref, manualCode }),
    });
  },

  // ============================================================
  // ADMIN — yêu cầu staff token
  // ============================================================

  // Dashboard thống kê đầy đủ (có doanh thu)
  async getAdminThongKe() {
    return this._fetch(`${this.BASE}/api/admin/thongke`, {}, true);
  },

  // Sản phẩm
  async getAdminSanPham(params = {}) {
    const q = new URLSearchParams(params).toString();
    return this._fetch(`${this.BASE}/api/admin/sanpham?${q}`, {}, true);
  },

  async addAdminSanPham(data) {
    return this._fetch(
      `${this.BASE}/api/admin/sanpham`,
      { method: 'POST', body: JSON.stringify(data) },
      true
    );
  },

  async updateAdminSanPham(ma, data) {
    return this._fetch(
      `${this.BASE}/api/admin/sanpham/${ma}`,
      { method: 'PUT', body: JSON.stringify(data) },
      true
    );
  },

  async deleteAdminSanPham(ma) {
    return this._fetch(
      `${this.BASE}/api/admin/sanpham/${ma}`,
      { method: 'DELETE' },
      true
    );
  },

  async toggleAdminSanPham(ma) {
    return this._fetch(
      `${this.BASE}/api/admin/sanpham/${ma}/toggle`,
      { method: 'PATCH' },
      true
    );
  },

  async importAdminSanPham(file) {
    const form = new FormData();
    form.append('file', file);
    const token = Auth.getStaffToken();
    const res = await fetch(`${this.BASE}/api/admin/sanpham/import`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    });
    return res.json();
  },

  // Đơn hàng
  async getAdminHoaDon(params = {}) {
    const q = new URLSearchParams(params).toString();
    return this._fetch(`${this.BASE}/api/admin/hoadon?${q}`, {}, true);
  },

  async updateHoaDonStatus(ma, trangThai) {
    return this._fetch(
      `${this.BASE}/api/admin/hoadon/${ma}/status`,
      { method: 'PUT', body: JSON.stringify({ TrangThai: trangThai }) },
      true
    );
  },

  async deleteHoaDon(ma) {
    return this._fetch(
      `${this.BASE}/api/admin/hoadon/${ma}`,
      { method: 'DELETE' },
      true
    );
  },

  // Khách hàng
  async getAdminKhachHang(params = {}) {
    const q = new URLSearchParams(params).toString();
    return this._fetch(`${this.BASE}/api/admin/khachhang?${q}`, {}, true);
  },

  async deleteAdminKhachHang(id) {
    return this._fetch(
      `${this.BASE}/api/admin/khachhang/${id}`,
      { method: 'DELETE' },
      true
    );
  },

  // Danh mục
  async addDanhMuc(data) {
    return this._fetch(
      `${this.BASE}/api/admin/danhmuc`,
      { method: 'POST', body: JSON.stringify(data) },
      true
    );
  },
  async updateDanhMuc(id, data) {
    return this._fetch(
      `${this.BASE}/api/admin/danhmuc/${id}`,
      { method: 'PUT', body: JSON.stringify(data) },
      true
    );
  },
  async deleteDanhMuc(id) {
    return this._fetch(
      `${this.BASE}/api/admin/danhmuc/${id}`,
      { method: 'DELETE' },
      true
    );
  },

  // Kế toán — phiếu thu
  async getPhieuThu() {
    return this._fetch(`${this.BASE}/api/ketoan/phieuthu`, {}, true);
  },
  async addPhieuThu(data) {
    return this._fetch(
      `${this.BASE}/api/ketoan/phieuthu`,
      { method: 'POST', body: JSON.stringify(data) },
      true
    );
  },

  // Kế toán — phiếu chi
  async getPhieuChi() {
    return this._fetch(`${this.BASE}/api/ketoan/phieuchi`, {}, true);
  },
  async addPhieuChi(data) {
    return this._fetch(
      `${this.BASE}/api/ketoan/phieuchi`,
      { method: 'POST', body: JSON.stringify(data) },
      true
    );
  },
  async approvePhieuChi(ma) {
    return this._fetch(
      `${this.BASE}/api/ketoan/phieuchi/${ma}/approve`,
      { method: 'PUT' },
      true
    );
  },

  // Quản lý staff (chỉ admin)
  async getAdminUsers() {
    return this._fetch(`${this.BASE}/api/admin/users`, {}, true);
  },
  async addAdminUser(data) {
    return this._fetch(
      `${this.BASE}/api/admin/users`,
      { method: 'POST', body: JSON.stringify(data) },
      true
    );
  },
  async updateAdminUser(id, data) {
    return this._fetch(
      `${this.BASE}/api/admin/users/${id}`,
      { method: 'PUT', body: JSON.stringify(data) },
      true
    );
  },
  async deleteAdminUser(id) {
    return this._fetch(
      `${this.BASE}/api/admin/users/${id}`,
      { method: 'DELETE' },
      true
    );
  },
};

// ============================================================
// UI HELPERS — cập nhật giao diện dựa trên trạng thái đăng nhập
// ============================================================

// Gọi hàm này sau khi đăng nhập / đăng xuất để cập nhật nav
function updateNavForAuthState() {
  const user = Auth.getCustomerUser();
  const isLoggedIn = Auth.isCustomerLoggedIn();

  // Ẩn/hiện nút đăng nhập và thông tin user
  const loginBtn = document.getElementById('nav-login-btn');
  const logoutBtn = document.getElementById('nav-logout-btn');
  const userDisplay = document.getElementById('nav-user-display');
  const guestCart = document.getElementById('nav-cart-guest-hint'); // tuỳ chọn

  if (loginBtn) loginBtn.style.display = isLoggedIn ? 'none' : '';
  if (logoutBtn) logoutBtn.style.display = isLoggedIn ? '' : 'none';
  if (userDisplay)
    userDisplay.textContent = isLoggedIn
      ? `👤 ${user?.hoten || user?.HoTen || 'Tài khoản'}`
      : '';
  if (guestCart) guestCart.style.display = isLoggedIn ? 'none' : '';
}

// Kiểm tra trước khi thêm vào giỏ / đặt hàng
// Trả về true nếu được phép, false nếu cần đăng nhập (và đã hiện modal)
function requireCustomerLogin(onSuccess) {
  if (Auth.isCustomerLoggedIn()) {
    if (onSuccess) onSuccess();
    return true;
  }
  // Hiện modal đăng nhập
  const modal = document.getElementById('modal-login');
  if (modal) {
    modal.style.display = 'flex';
    // Sau khi đăng nhập xong sẽ gọi lại onSuccess
    if (onSuccess) modal._pendingCallback = onSuccess;
  }
  return false;
}

// Gắn sự kiện cho form đăng nhập
document.addEventListener('DOMContentLoaded', () => {
  updateNavForAuthState();

  // Form đăng nhập khách hàng
  const formLogin = document.getElementById('form-customer-login');
  if (formLogin) {
    formLogin.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('login-email')?.value;
      const matKhau = document.getElementById('login-password')?.value;
      const errEl = document.getElementById('login-error');
      try {
        const result = await API.dangNhap(email, matKhau);
        if (result.error) {
          if (errEl) errEl.textContent = result.error;
          return;
        }
        updateNavForAuthState();
        // Đóng modal
        const modal = document.getElementById('modal-login');
        if (modal) {
          modal.style.display = 'none';
          // Gọi callback nếu có
          if (modal._pendingCallback) {
            modal._pendingCallback();
            modal._pendingCallback = null;
          }
        }
        showToast(
          'Đăng nhập thành công 🎉',
          `Chào ${result.user?.hoten || result.user?.HoTen}`
        );
      } catch (err) {
        if (errEl) errEl.textContent = err.message;
      }
    });
  }

  // Form đăng ký khách hàng
  const formRegister = document.getElementById('form-customer-register');
  if (formRegister) {
    formRegister.addEventListener('submit', async (e) => {
      e.preventDefault();
      const hoTen = document.getElementById('reg-hoten')?.value;
      const email = document.getElementById('reg-email')?.value;
      const matKhau = document.getElementById('reg-password')?.value;
      const errEl = document.getElementById('reg-error');
      try {
        const result = await API.dangKy(hoTen, email, matKhau);
        if (result.error) {
          if (errEl) errEl.textContent = result.error;
          return;
        }
        updateNavForAuthState();
        document
          .getElementById('modal-register')
          ?.style.setProperty('display', 'none');
        showToast('Đăng ký thành công 🎉', `Chào mừng ${hoTen}`);
      } catch (err) {
        if (errEl) errEl.textContent = err.message;
      }
    });
  }

  // Nút đăng xuất
  document.getElementById('nav-logout-btn')?.addEventListener('click', () => {
    API.dangXuat();
    showToast('Đã đăng xuất', 'Hẹn gặp lại 👋');
  });
});

// ============================================================
// DASHBOARD HELPERS (dành cho trang admin)
// ============================================================

async function loadDashboardStats() {
  // Nếu là staff → lấy thống kê đầy đủ (có doanh thu)
  // Nếu là khách công khai → chỉ có số sản phẩm
  let stats;
  if (Auth.isStaffLoggedIn()) {
    stats = await API.getAdminThongKe();
  } else {
    stats = await API._fetch(`${API.BASE}/api/thongke`);
  }

  if (document.getElementById('stat-sanpham'))
    document.getElementById('stat-sanpham').textContent =
      stats.tongSanPham?.toLocaleString('vi-VN') || 0;
  if (document.getElementById('stat-khachhang'))
    document.getElementById('stat-khachhang').textContent =
      stats.tongKhachHang?.toLocaleString('vi-VN') || 0;
  if (document.getElementById('stat-doanhthu'))
    document.getElementById('stat-doanhthu').textContent =
      stats.doanhThu != null
        ? stats.doanhThu.toLocaleString('vi-VN') + 'đ'
        : '—';
  if (document.getElementById('stat-hethang'))
    document.getElementById('stat-hethang').textContent = stats.hetHang || 0;
}

// Load danh sách sản phẩm vào bảng (admin view — cần staff token)
async function loadAdminSanPham(params = {}) {
  const { data, total } = await API.getAdminSanPham(params);
  const tbody = document.getElementById('prod-tbody');
  if (!tbody) return;
  tbody.innerHTML = data
    .map((p) => {
      const stock = parseInt(p.soluongton) || 0;
      const stockColor =
        stock === 0 ? '#f44336' : stock < 20 ? 'orange' : '#4caf50';
      const status =
        stock === 0
          ? '<span class="db-status status-cancel">❌ Hết Hàng</span>'
          : '<span class="db-status status-done">✅ Đang Bán</span>';
      return `<tr data-brand="${p.thuonghieu || ''}">
      <td>👟</td>
      <td>${
        p.tensanpham
      }<br><span style="font-size:11px;color:var(--gray-light)">SKU: ${
        p.sku || p.masanpham
      }</span></td>
      <td>${p.thuonghieu || ''}</td>
      <td>${p.danhmuc || ''}</td>
      <td style="font-family:monospace;color:var(--gray-light)">${
        p.gianhap ? Number(p.gianhap).toLocaleString('vi-VN') + 'đ' : '—'
      }</td>
      <td style="font-family:monospace;font-weight:700">${
        p.giaban ? Number(p.giaban).toLocaleString('vi-VN') + 'đ' : '—'
      }</td>
      <td><span style="color:${stockColor}">${stock}</span></td>
      <td>${status}</td>
      <td style="display:flex;gap:4px">
        <button class="db-btn-sm" onclick="editSanPham('${
          p.masanpham
        }')">Sửa</button>
        <button class="db-btn-sm" onclick="deleteSanPhamUI('${
          p.masanpham
        }')">Xóa</button>
      </td>
    </tr>`;
    })
    .join('');
  const countEl = document.getElementById('prod-list-count');
  if (countEl) countEl.textContent = `Danh Sách Sản Phẩm (${total})`;
}

// Import Excel vào DB (admin)
async function importFileToDatabase(file) {
  showToast('Đang import...', 'Vui lòng chờ');
  const result = await API.importAdminSanPham(file);
  if (result.error) {
    showToast('Lỗi ❌', result.error);
    return null;
  }
  showToast(
    `Import xong 🎉`,
    `✅ ${result.imported} · ⚠️ ${result.skipped} bỏ qua · ❌ ${result.failed} lỗi`
  );
  loadAdminSanPham();
  return result;
}

async function deleteSanPhamUI(ma) {
  if (!confirm(`Xóa sản phẩm ${ma}?`)) return;
  const res = await API.deleteAdminSanPham(ma);
  if (res.success) {
    showToast('Đã xóa', ma);
    loadAdminSanPham();
  } else showToast('Lỗi ❌', res.error);
}

// Gọi khi trang admin load
document.addEventListener('DOMContentLoaded', () => {
  if (Auth.isStaffLoggedIn()) {
    loadDashboardStats();
  }
});
