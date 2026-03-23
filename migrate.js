// ============================================================
// migrate.js — Migration SneakerVN
// Tương thích schema thực tế (file SQL đính kèm)
// Chạy: node migrate.js
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
  return crypto
    .createHash('sha256')
    .update(plain + JWT_SECRET)
    .digest('hex');
}

async function colExists(table, col) {
  const r = await pool.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_name = lower($1) AND column_name = lower($2)`,
    [table, col]
  );
  return r.rows.length > 0;
}

async function tblExists(table) {
  const r = await pool.query(
    `SELECT 1 FROM information_schema.tables WHERE table_name = lower($1)`,
    [table]
  );
  return r.rows.length > 0;
}

async function addCol(table, col, definition) {
  if (await colExists(table, col)) {
    console.log(`  ⏭  ${table}.${col} — đã tồn tại`);
    return;
  }
  await pool.query(`ALTER TABLE "${table}" ADD COLUMN "${col}" ${definition};`);
  console.log(`  ✅ ${table}.${col} — đã thêm`);
}

async function runMigration() {
  console.log('🚀 Bắt đầu migration SneakerVN...\n');

  const secretOk = JWT_SECRET !== 'sneakervn_secret_key_change_me';
  console.log(
    `JWT_SECRET: ${
      secretOk
        ? '✅ Đã cấu hình'
        : '⚠️  Đang dùng mặc định — nên đổi trong Replit Secrets'
    }\n`
  );

  try {
    await pool.query('SELECT 1');
    console.log('✅ Kết nối database OK\n');
  } catch (err) {
    console.error('❌ Không kết nối được:', err.message);
    process.exit(1);
  }

  // ═══════════════════════════════════════════════════════
  // BƯỚC 1 — Thêm cột còn thiếu vào các bảng hiện có
  // (Dùng IF NOT EXISTS logic qua colExists)
  // ═══════════════════════════════════════════════════════
  console.log('📋 Bước 1: Thêm cột còn thiếu...');

  try {
    // KhachHang
    await addCol('KhachHang', 'MatKhau', 'VARCHAR(255)');

    // NguoiQuanLy
    await addCol('NguoiQuanLy', 'MatKhau', 'VARCHAR(255)');
    await addCol('NguoiQuanLy', 'NgayTao', 'TIMESTAMP DEFAULT NOW()');

    // HoaDonBanHang — cột dành cho đơn hàng online
    await addCol(
      'HoaDonBanHang',
      'TrangThai',
      "VARCHAR(50) DEFAULT 'Chờ xử lý'"
    );
    await addCol('HoaDonBanHang', 'HoTenNguoiNhan', 'VARCHAR(200)');
    await addCol('HoaDonBanHang', 'SoDienThoaiNhan', 'VARCHAR(20)');
    await addCol('HoaDonBanHang', 'DiaChiGiao', 'TEXT');
    await addCol(
      'HoaDonBanHang',
      'PhuongThucTT',
      "VARCHAR(50) DEFAULT 'Tiền mặt'"
    );

    // CHI_TIET_HOA_DON — size/màu cho đơn online
    await addCol('CHI_TIET_HOA_DON', 'Size', "VARCHAR(20) DEFAULT ''");
    await addCol('CHI_TIET_HOA_DON', 'MauSac', "VARCHAR(50) DEFAULT ''");

    // PhieuThu / PhieuChi — timestamp
    await addCol('PhieuThu', 'NgayThu', 'TIMESTAMP DEFAULT NOW()');
    await addCol('PhieuChi', 'NgayChi', 'TIMESTAMP DEFAULT NOW()');

    // SanPham — TinhTrang (dùng để ẩn/hiện sản phẩm)
    await addCol('SanPham', 'TinhTrang', "VARCHAR(100) DEFAULT 'Đang bán'");

    // SanPham — HinhAnh (đường dẫn ảnh sản phẩm)
    await addCol('SanPham', 'HinhAnh', "TEXT DEFAULT ''");

    // DanhMuc — TrangThai
    await addCol('DanhMuc', 'TrangThai', "VARCHAR(50) DEFAULT 'Hoat dong'");
  } catch (err) {
    console.error('  ❌ Lỗi khi thêm cột:', err.message);
  }

  // ═══════════════════════════════════════════════════════
  // BƯỚC 2 — Tạo bảng GioHang_Online
  // (Tách khỏi bảng GioHang cũ dùng CartID để không xung đột)
  // ═══════════════════════════════════════════════════════
  console.log('\n📋 Bước 2: Bảng GioHang_Online (giỏ hàng khách đăng nhập)...');
  try {
    if (await tblExists('GioHang_Online')) {
      console.log('  ⏭  GioHang_Online — đã tồn tại');
    } else {
      await pool.query(`
        CREATE TABLE GioHang_Online (
          ID            SERIAL          PRIMARY KEY,
          CustomerID    INT             NOT NULL REFERENCES KhachHang(CustomerID) ON DELETE CASCADE,
          MaSanPham     VARCHAR(50)     NOT NULL REFERENCES SanPham(MaSanPham)   ON DELETE CASCADE,
          SoLuong       INT             NOT NULL DEFAULT 1 CHECK (SoLuong > 0),
          Size          VARCHAR(20)     DEFAULT '',
          MauSac        VARCHAR(50)     DEFAULT '',
          ThoiGianThem  TIMESTAMP       DEFAULT NOW()
        );
      `);
      console.log('  ✅ GioHang_Online — đã tạo');
    }
  } catch (err) {
    console.error('  ❌ GioHang_Online:', err.message);
  }

  // ═══════════════════════════════════════════════════════
  // BƯỚC 3 — Index
  // ═══════════════════════════════════════════════════════
  console.log('\n📋 Bước 3: Index...');
  const indexes = [
    `CREATE INDEX IF NOT EXISTS idx_giohang_online_cust ON GioHang_Online(CustomerID)`,
    `CREATE INDEX IF NOT EXISTS idx_hoadon_customer    ON HoaDonBanHang(CustomerID)`,
    `CREATE INDEX IF NOT EXISTS idx_sanpham_tinhtrang  ON SanPham(TinhTrang)`,
    `CREATE INDEX IF NOT EXISTS idx_kh_email           ON KhachHang(Email)`,
    `CREATE INDEX IF NOT EXISTS idx_nql_email          ON NguoiQuanLy(Email)`,
  ];
  for (const sql of indexes) {
    try {
      await pool.query(sql);
      console.log(`  ✅ ${sql.match(/idx_\w+/)?.[0]}`);
    } catch (err) {
      console.error(`  ❌ ${err.message}`);
    }
  }

  // ═══════════════════════════════════════════════════════
  // BƯỚC 4 — Tài khoản admin
  // ═══════════════════════════════════════════════════════
  console.log('\n👤 Bước 4: Tài khoản admin...');
  try {
    const r = await pool.query(
      "SELECT IDNguoiQuanLy, Email, MatKhau FROM NguoiQuanLy WHERE VaiTro = 'admin' LIMIT 1"
    );
    if (r.rows.length === 0) {
      await pool.query(
        `INSERT INTO NguoiQuanLy (HoTen, Email, SoDienThoai, MatKhau, VaiTro, TrangThai, NgayTao)
         VALUES ('Quản Trị Viên', 'admin@sneakervn.com', '', $1, 'admin', 'Hoạt động', NOW())`,
        [hashPw('Admin@123')]
      );
      console.log('  ✅ Đã tạo admin:');
      console.log('     Email   : admin@sneakervn.com');
      console.log('     Mật khẩu: Admin@123  ← ĐỔI NGAY!');
    } else {
      const admin = r.rows[0];
      if (!admin.makhau) {
        await pool.query(
          'UPDATE NguoiQuanLy SET MatKhau=$1 WHERE IDNguoiQuanLy=$2',
          [hashPw('Admin@123'), admin.idnguoiquanly]
        );
        console.log(`  ✅ Reset mật khẩu admin (${admin.email}) → Admin@123`);
      } else {
        console.log(
          `  ⏭  Admin (${admin.email}) đã có mật khẩu — không thay đổi`
        );
      }
    }
  } catch (err) {
    console.error('  ❌ Tài khoản admin:', err.message);
  }

  // ═══════════════════════════════════════════════════════
  // BƯỚC 5 — Tài khoản demo
  // ═══════════════════════════════════════════════════════
  console.log('\n👤 Bước 5: Tài khoản demo...');
  const demos = [
    {
      hoTen: 'Shop Demo',
      email: 'shopowner@sneakervn.com',
      pw: 'Shop@123',
      vaiTro: 'shop',
    },
    {
      hoTen: 'Kế Toán Demo',
      email: 'ketoan@sneakervn.com',
      pw: 'Accountant@123',
      vaiTro: 'accountant',
    },
  ];
  for (const a of demos) {
    try {
      const ex = await pool.query('SELECT 1 FROM NguoiQuanLy WHERE Email=$1', [
        a.email,
      ]);
      if (ex.rows.length > 0) {
        // Cập nhật hash nếu chưa có
        await pool.query(
          "UPDATE NguoiQuanLy SET MatKhau=$1 WHERE Email=$2 AND (MatKhau IS NULL OR MatKhau='')",
          [hashPw(a.pw), a.email]
        );
        console.log(`  ⏭  ${a.email} — đã tồn tại`);
      } else {
        await pool.query(
          `INSERT INTO NguoiQuanLy (HoTen, Email, MatKhau, VaiTro, TrangThai, NgayTao)
           VALUES ($1,$2,$3,$4,'Hoạt động',NOW())`,
          [a.hoTen, a.email, hashPw(a.pw), a.vaiTro]
        );
        console.log(`  ✅ ${a.email} / ${a.pw} [${a.vaiTro}]`);
      }
    } catch (err) {
      console.error(`  ❌ ${a.email}:`, err.message);
    }
  }

  // ═══════════════════════════════════════════════════════
  // BƯỚC 6 — Kiểm tra bảng
  // ═══════════════════════════════════════════════════════
  console.log('\n🔍 Bước 6: Kiểm tra bảng...');
  const tables = [
    'KhachHang',
    'NguoiQuanLy',
    'SanPham',
    'DanhMuc',
    'NhaCungCap',
    'GioHang',
    'GioHang_Online',
    'HoaDonBanHang',
    'CHI_TIET_HOA_DON',
    'PhieuNhap',
    'PhieuThu',
    'PhieuChi',
    'HINH_THUC_THANH_TOAN',
    'DANH_GIA',
  ];
  for (const t of tables) {
    const exists = await tblExists(t);
    console.log(`  ${exists ? '✅' : '❌'} ${t}`);
  }

  // ═══════════════════════════════════════════════════════
  // Bảng hash để dùng thủ công
  // ═══════════════════════════════════════════════════════
  console.log('\n🔑 Hash mật khẩu (dùng cho SQL thủ công):');
  ['Admin@123', 'Shop@123', 'Accountant@123', 'Member@123'].forEach((pw) => {
    console.log(`   ${pw.padEnd(20)} → ${hashPw(pw)}`);
  });

  console.log(`
════════════════════════════════════════════
✅ MIGRATION HOÀN TẤT

Lưu ý:
• /api/giohang      → bảng GioHang_Online
  (bảng GioHang cũ dùng CartID vẫn giữ nguyên)
• /api/sanpham      → ẩn TinhTrang='Ẩn' và GiaNhap
• Đăng nhập admin:
  POST /api/admin/auth/login
  { Email: "admin@sneakervn.com", MatKhau: "Admin@123" }
• Khởi động: node server.js
════════════════════════════════════════════
`);

  await pool.end();
}

runMigration().catch((err) => {
  console.error('💥 Migration thất bại:', err.message);
  process.exit(1);
});