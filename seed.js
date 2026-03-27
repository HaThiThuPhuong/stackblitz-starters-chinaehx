// ============================================================
// seed.js — Dữ liệu mẫu đầy đủ cho SneakerVN
// Chạy: node seed.js
// Yêu cầu: DATABASE_URL và JWT_SECRET trong .env
// ============================================================
import 'dotenv/config';
import pkg from 'pg';
import crypto from 'crypto';

const { Pool } = pkg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
const JWT_SECRET = process.env.JWT_SECRET || 'sneakervn_secret_key_change_me';

function hashPw(plain) {
  return crypto.createHash('sha256').update(plain + JWT_SECRET).digest('hex');
}

async function seed() {
  console.log('🌱 Bắt đầu seed dữ liệu SneakerVN...\n');

  try { await pool.query('SELECT 1'); console.log('✅ Kết nối DB OK\n'); }
  catch(e) { console.error('❌ Không kết nối được DB:', e.message); process.exit(1); }

  // ══════════════════════════════════════════════════════
  // 1. TÀI KHOẢN NHÂN VIÊN
  // ══════════════════════════════════════════════════════
  console.log('👤 1. Tài khoản nhân viên...');
  const staffAccounts = [
    { HoTen:'Nguyễn Thị Admin',  Email:'admin@sneakervn.com',    MatKhau:'admin@super',    VaiTro:'admin' },
    { HoTen:'Trần Văn Shop',     Email:'shop@sneakervn.com',      MatKhau:'shop@123',       VaiTro:'shop' },
    { HoTen:'Lê Thị Kế Toán',   Email:'ketoan@sneakervn.com',    MatKhau:'ketoan@123',     VaiTro:'accountant' },
  ];
  for (const s of staffAccounts) {
    try {
      const ex = await pool.query('SELECT idnguoiquanly FROM nguoiquanly WHERE email=$1',[s.Email]);
      if (ex.rows.length) {
        await pool.query(
          'UPDATE NguoiQuanLy SET HoTen=$1,MatKhau=$2,VaiTro=$3,TrangThai=\'Hoạt động\' WHERE Email=$4',
          [s.HoTen, hashPw(s.MatKhau), s.VaiTro, s.Email]
        );
        console.log(`  🔄 Cập nhật: ${s.Email} / ${s.MatKhau} [${s.VaiTro}]`);
      } else {
        await pool.query(
          `INSERT INTO nguoiquanly (hoten,email,sodienthoai,matkhau,vaitro,trangthai,ngaytao)
           VALUES ($1,$2,'0900000000',$3,$4,'Hoạt động',NOW())`,
          [s.HoTen, s.Email, hashPw(s.MatKhau), s.VaiTro]
        );
        console.log(`  ✅ Tạo mới: ${s.Email} / ${s.MatKhau} [${s.VaiTro}]`);
      }
    } catch(e) { console.error(`  ❌ ${s.Email}:`, e.message); }
  }

  // ══════════════════════════════════════════════════════
  // 2. TÀI KHOẢN KHÁCH HÀNG (thành viên test)
  // ══════════════════════════════════════════════════════
  console.log('\n👥 2. Tài khoản khách hàng...');
  const members = [
    { HoTen:'Nguyễn Minh Tuấn', Email:'member@sneakervn.com',   MatKhau:'member@123',  SoDienThoai:'0901111111', DiaChi:'123 Lê Lợi, Q1, HCM' },
    { HoTen:'Trần Thu Hà',      Email:'ha.tran@gmail.com',      MatKhau:'member@123',  SoDienThoai:'0902222222', DiaChi:'45 Nguyễn Huệ, Q1, HCM' },
    { HoTen:'Lê Quang Anh',     Email:'quanganh@gmail.com',     MatKhau:'member@123',  SoDienThoai:'0903333333', DiaChi:'78 Đinh Tiên Hoàng, Q3, HCM' },
  ];
  for (const m of members) {
    try {
      const ex = await pool.query('SELECT customerid FROM khachhang WHERE email=$1',[m.Email]);
      if (ex.rows.length) { console.log(`  ⏭  ${m.Email} — đã tồn tại`); continue; }
      await pool.query(
        `INSERT INTO khachhang (hoten,email,sodienthoai,diachi,matkhau,ngaytao)
         VALUES ($1,$2,$3,$4,$5,NOW())`,
        [m.HoTen, m.Email, m.SoDienThoai, m.DiaChi, hashPw(m.MatKhau)]
      );
      console.log(`  ✅ ${m.Email} / ${m.MatKhau}`);
    } catch(e) { console.error(`  ❌ ${m.Email}:`, e.message); }
  }

  // ══════════════════════════════════════════════════════
  // 3. DANH MỤC
  // ══════════════════════════════════════════════════════
  console.log('\n🗂️  3. Danh mục...');
  const cats = [
    { Ten:'Giày Sneaker',     Ma:'giay-sneaker',    Mota:'Giày thể thao phong cách' },
    { Ten:'Giày Chạy Bộ',     Ma:'giay-chay-bo',    Mota:'Giày chuyên dụng chạy bộ' },
    { Ten:'Giày Bóng Rổ',     Ma:'giay-bong-ro',    Mota:'Giày chơi bóng rổ' },
    { Ten:'Streetwear',       Ma:'streetwear',       Mota:'Phong cách đường phố' },
    { Ten:'Phụ Kiện',         Ma:'phu-kien',         Mota:'Tất, balo, dây buộc' },
  ];
  for (const c of cats) {
    try {
      const ex = await pool.query('SELECT 1 FROM danhmuc WHERE ma=$1',[c.Ma]);
      if (ex.rows.length) { console.log(`  ⏭  ${c.Ten} — đã tồn tại`); continue; }
      await pool.query(
        `INSERT INTO danhmuc (ten,ma,mota,trangthai) VALUES ($1,$2,$3,'Hoat dong')`,
        [c.Ten, c.Ma, c.Mota]
      );
      console.log(`  ✅ ${c.Ten}`);
    } catch(e) { console.error(`  ❌ ${c.Ten}:`, e.message); }
  }

  // ══════════════════════════════════════════════════════
  // 4. SẢN PHẨM
  // ══════════════════════════════════════════════════════
  console.log('\n👟 4. Sản phẩm...');
  const products = [
    // Nike
    { MaSanPham:'NK-AM270-001',  TenSanPham:'Nike Air Max 270',         ThuongHieu:'Nike',       DanhMuc:'Giày Sneaker', GiaNhap:2200000, GiaBan:3200000, Size:'36,37,38,39,40,41,42,43', MauSac:'Đen/Trắng',   SoLuongTon:42, SKU:'NK-AM270-001', MoTaSanPham:'Đế Air Max 270 siêu nhẹ, đệm tối ưu', TinhTrang:'Đang bán' },
    { MaSanPham:'NK-AF1-002',    TenSanPham:'Nike Air Force 1 Low',     ThuongHieu:'Nike',       DanhMuc:'Giày Sneaker', GiaNhap:1800000, GiaBan:2600000, Size:'36,37,38,39,40,41,42,43,44', MauSac:'Trắng',     SoLuongTon:65, SKU:'NK-AF1-002',   MoTaSanPham:'Classic White - huyền thoại của Nike',  TinhTrang:'Đang bán' },
    { MaSanPham:'NK-DUNK-003',   TenSanPham:'Nike Dunk Low Retro',      ThuongHieu:'Nike',       DanhMuc:'Giày Sneaker', GiaNhap:1900000, GiaBan:2800000, Size:'37,38,39,40,41,42,43',     MauSac:'Panda',       SoLuongTon:28, SKU:'NK-DUNK-003',  MoTaSanPham:'Dunk Low Panda đen trắng iconic',       TinhTrang:'Đang bán' },
    { MaSanPham:'NK-AJ1-004',    TenSanPham:'Nike Air Jordan 1 Retro High', ThuongHieu:'Nike',   DanhMuc:'Giày Bóng Rổ', GiaNhap:3500000, GiaBan:5200000, Size:'38,39,40,41,42,43,44',    MauSac:'Chicago',     SoLuongTon:15, SKU:'NK-AJ1-004',   MoTaSanPham:'AJ1 Chicago đỏ trắng huyền thoại',     TinhTrang:'Đang bán' },
    { MaSanPham:'NK-PEGASUS-005',TenSanPham:'Nike Pegasus 40',           ThuongHieu:'Nike',       DanhMuc:'Giày Chạy Bộ', GiaNhap:2100000, GiaBan:3100000, Size:'37,38,39,40,41,42,43,44', MauSac:'Xanh Navy',  SoLuongTon:33, SKU:'NK-PEGASUS-005',MoTaSanPham:'Giày chạy bộ đệm React foam',          TinhTrang:'Đang bán' },
    // Adidas
    { MaSanPham:'AD-UB22-006',   TenSanPham:'Adidas Ultraboost 22',     ThuongHieu:'Adidas',     DanhMuc:'Giày Chạy Bộ', GiaNhap:3200000, GiaBan:4500000, Size:'37,38,39,40,41,42,43',     MauSac:'Trắng/Đen',  SoLuongTon:18, SKU:'AD-UB22-006',  MoTaSanPham:'Boost technology, phản hồi năng lượng', TinhTrang:'Đang bán' },
    { MaSanPham:'AD-STAN-007',   TenSanPham:'Adidas Stan Smith',        ThuongHieu:'Adidas',     DanhMuc:'Giày Sneaker', GiaNhap:1600000, GiaBan:2400000, Size:'36,37,38,39,40,41,42,43',  MauSac:'Trắng/Xanh', SoLuongTon:52, SKU:'AD-STAN-007',  MoTaSanPham:'Giày classic 3 sọc huyền thoại',       TinhTrang:'Đang bán' },
    { MaSanPham:'AD-CAMPUS-008', TenSanPham:'Adidas Campus 00s',        ThuongHieu:'Adidas',     DanhMuc:'Giày Sneaker', GiaNhap:1700000, GiaBan:2500000, Size:'36,37,38,39,40,41,42',      MauSac:'Nâu/Trắng',  SoLuongTon:41, SKU:'AD-CAMPUS-008',MoTaSanPham:'Retro chunky sole đang hot 2024',       TinhTrang:'Đang bán' },
    { MaSanPham:'AD-SAMBA-009',  TenSanPham:'Adidas Samba OG',          ThuongHieu:'Adidas',     DanhMuc:'Giày Sneaker', GiaNhap:1800000, GiaBan:2700000, Size:'37,38,39,40,41,42,43',     MauSac:'Đen/Trắng',  SoLuongTon:37, SKU:'AD-SAMBA-009', MoTaSanPham:'Samba OG - icon của Adidas Originals',  TinhTrang:'Đang bán' },
    // MLB
    { MaSanPham:'MLB-CHUNKY-010',TenSanPham:'MLB Big Ball Chunky',      ThuongHieu:'MLB',        DanhMuc:'Giày Sneaker', GiaNhap:1500000, GiaBan:2200000, Size:'36,37,38,39,40,41,42',      MauSac:'Trắng',      SoLuongTon:60, SKU:'MLB-CHUNKY-010',MoTaSanPham:'Chunky sole phong cách Hàn Quốc',      TinhTrang:'Đang bán' },
    { MaSanPham:'MLB-NY-011',    TenSanPham:'MLB NY Yankees Cap',       ThuongHieu:'MLB',        DanhMuc:'Phụ Kiện',     GiaNhap:350000,  GiaBan:720000,  Size:'Free Size',                 MauSac:'Đen',        SoLuongTon:5,  SKU:'MLB-NY-011',   MoTaSanPham:'Mũ snapback NY Yankees chính hãng',    TinhTrang:'Đang bán' },
    // New Balance
    { MaSanPham:'NB-550-012',    TenSanPham:'New Balance 550 White',    ThuongHieu:'New Balance',DanhMuc:'Giày Sneaker', GiaNhap:2000000, GiaBan:2900000, Size:'36,37,38,39,40,41,42,43',  MauSac:'Trắng/Xanh', SoLuongTon:45, SKU:'NB-550-012',   MoTaSanPham:'Retro basketball style năm 1989',       TinhTrang:'Đang bán' },
    { MaSanPham:'NB-574-013',    TenSanPham:'New Balance 574 Core',     ThuongHieu:'New Balance',DanhMuc:'Giày Sneaker', GiaNhap:1800000, GiaBan:2600000, Size:'36,37,38,39,40,41,42',      MauSac:'Xanh Navy',  SoLuongTon:30, SKU:'NB-574-013',   MoTaSanPham:'Lightweight mesh upper, suede panels',  TinhTrang:'Đang bán' },
    // Puma
    { MaSanPham:'PM-RSX-014',    TenSanPham:'Puma RS-X Reinvention',   ThuongHieu:'Puma',       DanhMuc:'Giày Sneaker', GiaNhap:1400000, GiaBan:2100000, Size:'37,38,39,40,41,42,43',     MauSac:'Trắng/Vàng', SoLuongTon:22, SKU:'PM-RSX-014',   MoTaSanPham:'Running System X - đế dày chunky',     TinhTrang:'Đang bán' },
    // Vans
    { MaSanPham:'VN-OLDSK-015',  TenSanPham:'Vans Old Skool',           ThuongHieu:'Vans',       DanhMuc:'Giày Sneaker', GiaNhap:1200000, GiaBan:1800000, Size:'36,37,38,39,40,41,42,43,44',MauSac:'Đen/Trắng',  SoLuongTon:55, SKU:'VN-OLDSK-015', MoTaSanPham:'Canvas và suede, sọc waffle signature',TinhTrang:'Đang bán' },
    { MaSanPham:'VN-SK8-016',    TenSanPham:'Vans SK8-Hi',              ThuongHieu:'Vans',       DanhMuc:'Giày Sneaker', GiaNhap:1300000, GiaBan:2000000, Size:'37,38,39,40,41,42,43',     MauSac:'Đen',        SoLuongTon:28, SKU:'VN-SK8-016',   MoTaSanPham:'Cổ cao skate classic của Vans',         TinhTrang:'Đang bán' },
    // Converse
    { MaSanPham:'CV-CT70-017',   TenSanPham:'Converse Chuck Taylor All Star 70', ThuongHieu:'Converse', DanhMuc:'Giày Sneaker', GiaNhap:900000, GiaBan:1500000, Size:'36,37,38,39,40,41,42,43,44', MauSac:'Trắng', SoLuongTon:70, SKU:'CV-CT70-017', MoTaSanPham:'Chuck 70 vintage canvas, thương hiệu mỹ', TinhTrang:'Đang bán' },
    // Fila
    { MaSanPham:'FL-DISR-018',   TenSanPham:'Fila Disruptor II',        ThuongHieu:'Fila',       DanhMuc:'Giày Sneaker', GiaNhap:1100000, GiaBan:1700000, Size:'36,37,38,39,40,41,42',     MauSac:'Trắng',      SoLuongTon:35, SKU:'FL-DISR-018',  MoTaSanPham:'Chunky sole - biểu tượng của Fila',    TinhTrang:'Đang bán' },
    // Hết hàng (test)
    { MaSanPham:'NK-AJ1-019',    TenSanPham:'Nike Air Jordan 1 Low OG', ThuongHieu:'Nike',       DanhMuc:'Giày Bóng Rổ', GiaNhap:2800000, GiaBan:4200000, Size:'38,39,40,41,42,43',        MauSac:'Bred',        SoLuongTon:0,  SKU:'NK-AJ1-019',  MoTaSanPham:'Jordan 1 Low phối màu Bred đỏ đen',     TinhTrang:'Hết hàng' },
  ];

  let inserted = 0, updated = 0;
  for (const p of products) {
    try {
      const ex = await pool.query('SELECT masanpham FROM sanpham WHERE masanpham=$1',[p.MaSanPham]);
      if (ex.rows.length) {
        await pool.query(
          `UPDATE sanpham SET tensanpham=$1,thuonghieu=$2,madanhmuc=$3,gianhap=$4,giaban=$5,
           size=$6,mausac=$7,soluongton=$8,sku=$9,motasanpham=$10,tinhtrang=$11
           WHERE masanpham=$12`,
          [p.TenSanPham,p.ThuongHieu,p.DanhMuc,p.GiaNhap,p.GiaBan,
           p.Size,p.MauSac,p.SoLuongTon,p.SKU,p.MoTaSanPham,p.TinhTrang,p.MaSanPham]
        );
        updated++;
      } else {
        await pool.query(
          `INSERT INTO sanpham (masanpham,tensanpham,thuonghieu,madanhmuc,gianhap,giaban,
           size,mausac,soluongton,sku,motasanpham,tinhtrang)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [p.MaSanPham,p.TenSanPham,p.ThuongHieu,p.DanhMuc,p.GiaNhap,p.GiaBan,
           p.Size,p.MauSac,p.SoLuongTon,p.SKU,p.MoTaSanPham,p.TinhTrang]
        );
        inserted++;
      }
    } catch(e) { console.error(`  ❌ ${p.MaSanPham}:`, e.message); }
  }
  console.log(`  ✅ Thêm mới: ${inserted} SP | Cập nhật: ${updated} SP`);

  // ══════════════════════════════════════════════════════
  // 5. ĐƠN HÀNG MẪU
  // ══════════════════════════════════════════════════════
  console.log('\n📦 5. Đơn hàng mẫu...');
  const orders = [
    { MaHoaDon:'SVN-2026-001', ten:'Nguyễn Minh Tuấn', sdt:'0901111111', dia:'123 Lê Lợi Q1 HCM', tong:3200000, pttt:'QR Code',       tt:'Hoàn thành',  maSP:'NK-AM270-001', sl:1 },
    { MaHoaDon:'SVN-2026-002', ten:'Trần Thu Hà',      sdt:'0902222222', dia:'45 Nguyễn Huệ Q1',  tong:2400000, pttt:'Chuyển khoản',  tt:'Đang giao',   maSP:'AD-STAN-007',  sl:1 },
    { MaHoaDon:'SVN-2026-003', ten:'Lê Quang Anh',     sdt:'0903333333', dia:'78 Đinh Tiên Hoàng',tong:4400000, pttt:'Tiền mặt',      tt:'Hoàn thành',  maSP:'MLB-CHUNKY-010',sl:2 },
    { MaHoaDon:'SVN-2026-004', ten:'Phạm Thị Lan',     sdt:'0904444444', dia:'99 Lý Tự Trọng Q1', tong:2900000, pttt:'QR Code',       tt:'Chờ xử lý',   maSP:'NB-550-012',   sl:1 },
    { MaHoaDon:'SVN-2026-005', ten:'Hoàng Minh Nam',   sdt:'0905555555', dia:'12 Cách Mạng Tháng 8',tong:5200000,pttt:'Chuyển khoản', tt:'Đã xác nhận', maSP:'NK-AJ1-004',   sl:1 },
    { MaHoaDon:'SVN-2026-006', ten:'Vũ Thị Mai',       sdt:'0906666666', dia:'34 Nguyễn Thị Minh Khai',tong:1800000,pttt:'Ví MoMo',  tt:'Hoàn thành',  maSP:'VN-OLDSK-015', sl:1 },
    { MaHoaDon:'SVN-2026-007', ten:'Đinh Quốc Huy',    sdt:'0907777777', dia:'56 Võ Văn Tần Q3',   tong:4500000, pttt:'Chuyển khoản',  tt:'Đang giao',   maSP:'AD-UB22-006',  sl:1 },
    { MaHoaDon:'SVN-2026-008', ten:'Ngô Thanh Tú',     sdt:'0908888888', dia:'78 Nguyễn Trãi Q5',  tong:2600000, pttt:'QR Code',       tt:'Đã hủy',      maSP:'NK-AF1-002',   sl:1 },
  ];

  for (const o of orders) {
    try {
      const ex = await pool.query('SELECT 1 FROM hoadonbanhang WHERE mahoadon=$1',[o.MaHoaDon]);
      if (ex.rows.length) { console.log(`  ⏭  ${o.MaHoaDon} — đã tồn tại`); continue; }
      await pool.query(
        `INSERT INTO hoadonbanhang
         (mahoadon,hotennguoinhan,sodienthoainhan,diachigiao,tongtien,phuongthuctt,trangthai,ngayban)
         VALUES ($1,$2,$3,$4,$5,$6,$7,NOW() - (random()*30)::int * INTERVAL '1 day')`,
        [o.MaHoaDon,o.ten,o.sdt,o.dia,o.tong,o.pttt,o.tt]
      );
      // Chi tiết đơn hàng
      await pool.query(
        `INSERT INTO chi_tiet_hoa_don (mahoadon,masanpham,soluong,dongia,size,mausac)
         VALUES ($1,$2,$3,$4,'42','Mặc định')`,
        [o.MaHoaDon, o.maSP, o.sl, Math.round(o.tong/o.sl)]
      );
      console.log(`  ✅ ${o.MaHoaDon} — ${o.ten} — ${o.tong.toLocaleString()}đ [${o.tt}]`);
    } catch(e) { console.error(`  ❌ ${o.MaHoaDon}:`, e.message); }
  }

  // ══════════════════════════════════════════════════════
  // TỔNG KẾT
  // ══════════════════════════════════════════════════════
  const [spCount, khCount, dhCount, nvCount, dmCount] = await Promise.all([
    pool.query('SELECT COUNT(*) FROM sanpham'),
    pool.query('SELECT COUNT(*) FROM khachhang'),
    pool.query('SELECT COUNT(*) FROM hoadonbanhang'),
    pool.query('SELECT COUNT(*) FROM nguoiquanly'),
    pool.query('SELECT COUNT(*) FROM danhmuc'),
  ]);

  console.log(`
════════════════════════════════════════════
✅ SEED HOÀN TẤT

📊 Database hiện tại:
   👟 Sản phẩm    : ${spCount.rows[0].count}
   👥 Khách hàng  : ${khCount.rows[0].count}
   📦 Đơn hàng    : ${dhCount.rows[0].count}
   👤 Nhân viên   : ${nvCount.rows[0].count}
   🗂️  Danh mục   : ${dmCount.rows[0].count}

🔐 Tài khoản đăng nhập:
   ┌─────────────────────────────────────────────────────┐
   │ Role        │ Email                    │ Mật khẩu   │
   ├─────────────────────────────────────────────────────┤
   │ 👤 Thành Viên│ member@sneakervn.com    │ member@123 │
   │ 👑 Chủ Shop  │ shop@sneakervn.com      │ shop@123   │
   │ 📒 Kế Toán   │ ketoan@sneakervn.com    │ ketoan@123 │
   │ 🛡️  Super Admin│ admin@sneakervn.com   │ admin@super│
   └─────────────────────────────────────────────────────┘
════════════════════════════════════════════`);

  await pool.end();
}

seed().catch(e => { console.error('Seed thất bại:', e.message); process.exit(1); });