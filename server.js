// ============================================================
// server.js — Backend API cho SneakerVN
// Xác thực JWT, phân quyền rõ ràng:
//   - Khách vãn lai  : chỉ xem sản phẩm, tạo đơn hàng khách
//   - Khách đăng nhập: giỏ hàng riêng, lịch sử đơn hàng riêng
//   - shop / admin / accountant: admin routes (yêu cầu JWT hợp lệ)
// ============================================================

import express from "express";
import pkg from "pg";
import cors from "cors";
import multer from "multer";
import ExcelJS from "exceljs";
import crypto from "crypto";

const { Pool } = pkg;
const app = express();
const upload = multer({ storage: multer.memoryStorage() });

// ── Kết nối Database ────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

app.use(cors());
app.use(express.json());
app.use(express.static("."));

// ============================================================
// JWT — tự triển khai nhẹ (không cần thư viện ngoài)
// Sử dụng HMAC-SHA256, lưu secret trong env JWT_SECRET
// ============================================================

const JWT_SECRET = process.env.JWT_SECRET || "sneakervn_secret_key_change_me";

function base64url(str) {
  return Buffer.from(str)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function signJWT(payload, expiresInSec = 86400) {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64url(
    JSON.stringify({
      ...payload,
      exp: Math.floor(Date.now() / 1000) + expiresInSec,
      iat: Math.floor(Date.now() / 1000),
    }),
  );
  const sig = crypto
    .createHmac("sha256", JWT_SECRET)
    .update(`${header}.${body}`)
    .digest("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  return `${header}.${body}.${sig}`;
}

function verifyJWT(token) {
  try {
    const [header, body, sig] = token.split(".");
    const expected = crypto
      .createHmac("sha256", JWT_SECRET)
      .update(`${header}.${body}`)
      .digest("base64")
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
    if (sig !== expected) return null;
    const payload = JSON.parse(Buffer.from(body, "base64").toString());
    if (payload.exp < Math.floor(Date.now() / 1000)) return null; // hết hạn
    return payload;
  } catch {
    return null;
  }
}

// ── Middleware: đọc token từ header Authorization ──────────
function parseToken(req, res, next) {
  const auth = req.headers["authorization"] || "";
  if (auth.startsWith("Bearer ")) {
    req.user = verifyJWT(auth.slice(7));
  } else {
    req.user = null; // khách vãn lai
  }
  next();
}

// ── Middleware: yêu cầu đăng nhập (khách hàng hoặc staff) ──
function requireLogin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Vui lòng đăng nhập" });
  next();
}

// ── Middleware: yêu cầu vai trò nội bộ (staff) ─────────────
// QUAN TRỌNG: xác thực qua JWT chứ KHÔNG tin header x-role thô
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "Chưa xác thực" });
    // Người dùng nội bộ phải có trường 'role' trong JWT payload
    if (!req.user.role || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Không có quyền truy cập" });
    }
    next();
  };
}

app.use(parseToken);

// ============================================================
// HEALTH CHECK
// ============================================================
app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok" });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// ============================================================
// XÁC THỰC — KHÁCH HÀNG (đăng ký / đăng nhập)
// ============================================================

// POST /api/auth/register — Khách hàng đăng ký
app.post("/api/auth/register", async (req, res) => {
  try {
    const { HoTen, Email, SoDienThoai, MatKhau, DiaChi } = req.body;
    if (!HoTen || !Email || !MatKhau)
      return res
        .status(400)
        .json({ error: "Thiếu họ tên, email hoặc mật khẩu" });

    // Kiểm tra email đã tồn tại
    const exists = await pool.query(
      "SELECT CustomerID FROM KhachHang WHERE Email=$1",
      [Email],
    );
    if (exists.rows.length)
      return res.status(409).json({ error: "Email đã được sử dụng" });

    const hashedPw = crypto
      .createHash("sha256")
      .update(MatKhau + JWT_SECRET)
      .digest("hex");
    const r = await pool.query(
      `INSERT INTO KhachHang (HoTen, Email, SoDienThoai, DiaChi, MatKhau, NgayTao)
       VALUES ($1,$2,$3,$4,$5,NOW()) RETURNING CustomerID, HoTen, Email, SoDienThoai, DiaChi`,
      [HoTen, Email, SoDienThoai || "", DiaChi || "", hashedPw],
    );
    const customer = r.rows[0];
    const token = signJWT({
      id: customer.customerid,
      email: customer.email,
      type: "customer",
    });
    res.json({ success: true, token, user: customer });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// POST /api/auth/login — Khách hàng đăng nhập
app.post("/api/auth/login", async (req, res) => {
  try {
    const { Email, MatKhau } = req.body;
    if (!Email || !MatKhau)
      return res.status(400).json({ error: "Thiếu email hoặc mật khẩu" });

    const hashedPw = crypto
      .createHash("sha256")
      .update(MatKhau + JWT_SECRET)
      .digest("hex");
    const r = await pool.query(
      "SELECT CustomerID, HoTen, Email, SoDienThoai, DiaChi FROM KhachHang WHERE Email=$1 AND MatKhau=$2",
      [Email, hashedPw],
    );
    if (!r.rows.length)
      return res.status(401).json({ error: "Email hoặc mật khẩu không đúng" });

    const customer = r.rows[0];
    const token = signJWT({
      id: customer.customerid,
      email: customer.email,
      type: "customer",
    });
    res.json({ success: true, token, user: customer });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// POST /api/auth/me — Lấy thông tin khách hàng đang đăng nhập
app.get("/api/auth/me", requireLogin, async (req, res) => {
  try {
    if (req.user.type !== "customer")
      return res.status(403).json({ error: "Chỉ dành cho khách hàng" });
    const r = await pool.query(
      "SELECT CustomerID, HoTen, Email, SoDienThoai, DiaChi FROM KhachHang WHERE CustomerID=$1",
      [req.user.id],
    );
    if (!r.rows.length)
      return res.status(404).json({ error: "Không tìm thấy" });
    res.json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/auth/me — Cập nhật thông tin cá nhân
app.put("/api/auth/me", requireLogin, async (req, res) => {
  try {
    if (req.user.type !== "customer")
      return res.status(403).json({ error: "Chỉ dành cho khách hàng" });
    const { HoTen, SoDienThoai, DiaChi } = req.body;
    const r = await pool.query(
      "UPDATE KhachHang SET HoTen=$1, SoDienThoai=$2, DiaChi=$3 WHERE CustomerID=$4 RETURNING CustomerID, HoTen, Email, SoDienThoai, DiaChi",
      [HoTen, SoDienThoai, DiaChi, req.user.id],
    );
    res.json({ success: true, user: r.rows[0] });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ============================================================
// XÁC THỰC — NHÂN VIÊN / QUẢN TRỊ VIÊN / KẾ TOÁN
// ============================================================

// POST /api/admin/auth/login — Staff đăng nhập
app.post("/api/admin/auth/login", async (req, res) => {
  try {
    const { Email, MatKhau } = req.body;
    if (!Email || !MatKhau)
      return res.status(400).json({ error: "Thiếu email hoặc mật khẩu" });

    const hashedPw = crypto
      .createHash("sha256")
      .update(MatKhau + JWT_SECRET)
      .digest("hex");
    const r = await pool.query(
      `SELECT IDNguoiQuanLy, HoTen, Email, VaiTro, TrangThai FROM NguoiQuanLy 
       WHERE Email=$1 AND MatKhau=$2 AND TrangThai='Hoạt động'`,
      [Email, hashedPw],
    );
    if (!r.rows.length)
      return res
        .status(401)
        .json({ error: "Sai thông tin đăng nhập hoặc tài khoản bị khóa" });

    const staff = r.rows[0];
    const token = signJWT({
      id: staff.idnguoiquanly,
      email: staff.email,
      role: staff.vaitro, // 'admin' | 'shop' | 'accountant'
      type: "staff",
    });
    res.json({
      success: true,
      token,
      user: {
        id: staff.idnguoiquanly,
        hoTen: staff.hoten,
        email: staff.email,
        role: staff.vaitro,
      },
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ============================================================
// SẢN PHẨM — CÔNG KHAI (khách vãn lai + khách đăng nhập đều xem được)
// ============================================================

app.get("/api/sanpham", async (req, res) => {
  try {
    const { search, danhmuc, thuonghieu, page = 1, limit = 50 } = req.query;
    let query =
      "SELECT MaSanPham,TenSanPham,ThuongHieu,DanhMuc,GiaBan,Size,MauSac,MoTaSanPham,SoLuongTon,SKU,TinhTrang FROM SanPham WHERE TinhTrang != 'Ẩn'";
    const params = [];

    if (search) {
      params.push(`%${search}%`);
      query += ` AND (TenSanPham ILIKE $${params.length} OR MaSanPham ILIKE $${params.length} OR SKU ILIKE $${params.length})`;
    }
    if (danhmuc) {
      params.push(danhmuc);
      query += ` AND DanhMuc = $${params.length}`;
    }
    if (thuonghieu) {
      params.push(thuonghieu);
      query += ` AND ThuongHieu = $${params.length}`;
    }

    query += ` ORDER BY TenSanPham LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(parseInt(limit), (parseInt(page) - 1) * parseInt(limit));

    const [result, countResult] = await Promise.all([
      pool.query(query, params),
      pool.query("SELECT COUNT(*) FROM SanPham WHERE TinhTrang != 'Ẩn'"),
    ]);
    // KHÔNG trả GiaNhap cho khách hàng ngoài
    res.json({ data: result.rows, total: parseInt(countResult.rows[0].count) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Danh mục & Nhà cung cấp — công khai
// ── TÌM KIẾM BẰNG HÌNH ẢNH — Gemini Vision ─────────────────
app.post("/api/search/image", async (req, res) => {
  try {
    const { image } = req.body;
    if (!image) return res.status(400).json({ error: "Thiếu ảnh" });

    const GEMINI_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_KEY) return res.status(500).json({ error: "Chưa cấu hình Gemini API" });

    // Chuyển base64 data URL thành raw base64
    const base64 = image.replace(/^data:image\/\w+;base64,/, '');
    const mimeMatch = image.match(/^data:(image\/\w+);base64,/);
    const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';

    // Lấy danh sách thương hiệu từ DB
    const brandsRes = await pool.query(
      "SELECT DISTINCT ThuongHieu FROM SanPham WHERE TinhTrang != 'Ẩn' ORDER BY ThuongHieu"
    );
    const brands = brandsRes.rows.map(r => r.thuonghieu || r.ThuongHieu).join(', ');

    // Gọi Gemini Vision
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            role: 'user',
            parts: [
              {
                inline_data: { mime_type: mimeType, data: base64 }
              },
              {
                text: `Phân tích hình ảnh giày này và trả về JSON với format sau (chỉ JSON, không giải thích):
{
  "brand": "tên thương hiệu (chỉ chọn từ: ${brands})",
  "model": "tên model nếu nhận ra",
  "color": "màu sắc chính",
  "type": "loại giày (sneaker/running/basketball/...)",
  "query": "từ khóa tìm kiếm ngắn gọn bằng tiếng Việt",
  "description": "mô tả ngắn bằng tiếng Việt"
}`
              }
            ]
          }],
          generationConfig: { maxOutputTokens: 300, temperature: 0.3 }
        })
      }
    );

    const geminiData = await geminiRes.json();
    if (geminiData.error) {
      console.error('Gemini Vision error:', geminiData.error);
      return res.status(500).json({ error: 'Lỗi phân tích ảnh: ' + geminiData.error.message });
    }

    const rawText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    // Parse JSON từ response
    let parsed = {};
    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
    } catch(e) {
      console.error('Parse error:', e.message, rawText);
    }

    // Tạo query tìm kiếm
    const query = parsed.query || parsed.brand || parsed.model || 'giày';

    res.json({
      query,
      brand:       parsed.brand || '',
      model:       parsed.model || '',
      color:       parsed.color || '',
      description: parsed.description || `Tìm: ${query}`,
    });

  } catch(e) {
    console.error('Image search error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/danhmuc", async (req, res) => {
  const result = await pool.query(
    "SELECT * FROM DanhMuc WHERE TrangThai='Hoat dong' ORDER BY 1",
  );
  res.json(result.rows);
});

app.get("/api/nhacungcap", async (req, res) => {
  const result = await pool.query(
    "SELECT SupplierID,TenNhaCungCap FROM NhaCungCap ORDER BY TenNhaCungCap",
  );
  res.json(result.rows);
});

// Dashboard thống kê tóm tắt — công khai (chỉ hiển thị số đếm, không doanh thu)
app.get("/api/thongke", async (req, res) => {
  try {
    const [sanpham, hetHang] = await Promise.all([
      pool.query(
        "SELECT COUNT(*) as total FROM SanPham WHERE TinhTrang != 'Ẩn'",
      ),
      pool.query("SELECT COUNT(*) as total FROM SanPham WHERE SoLuongTon = 0"),
    ]);
    res.json({
      tongSanPham: parseInt(sanpham.rows[0].total),
      hetHang: parseInt(hetHang.rows[0].total),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// GIỎ HÀNG — chỉ khách đã đăng nhập (type: customer)
// ============================================================

// GET /api/giohang — Lấy giỏ hàng của khách đăng nhập
app.get("/api/giohang", requireLogin, async (req, res) => {
  if (req.user.type !== "customer")
    return res.status(403).json({ error: "Chỉ dành cho khách hàng" });
  try {
    const r = await pool.query(
      `SELECT g.ID, g.MaSanPham, g.SoLuong, g.Size, g.MauSac,
              s.TenSanPham, s.GiaBan, s.SoLuongTon
       FROM GioHang_Online g JOIN SanPham s ON g.MaSanPham = s.MaSanPham
       WHERE g.CustomerID = $1 ORDER BY g.ID`,
      [req.user.id],
    );
    res.json(r.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/giohang — Thêm vào giỏ
app.post("/api/giohang", requireLogin, async (req, res) => {
  if (req.user.type !== "customer")
    return res.status(403).json({ error: "Chỉ dành cho khách hàng" });
  try {
    const { MaSanPham, SoLuong = 1, Size, MauSac } = req.body;
    if (!MaSanPham) return res.status(400).json({ error: "Thiếu MaSanPham" });
    // Kiểm tra tồn kho
    const sp = await pool.query(
      "SELECT SoLuongTon FROM SanPham WHERE MaSanPham=$1 AND TinhTrang!='Ẩn'",
      [MaSanPham],
    );
    if (!sp.rows.length)
      return res.status(404).json({ error: "Sản phẩm không tồn tại" });
    if (sp.rows[0].soLuongTon < SoLuong)
      return res.status(400).json({ error: "Không đủ hàng" });

    // Nếu đã có → cộng số lượng
    const existing = await pool.query(
      "SELECT ID, SoLuong FROM GioHang_Online WHERE CustomerID=$1 AND MaSanPham=$2 AND Size=$3 AND MauSac=$4",
      [req.user.id, MaSanPham, Size || "", MauSac || ""],
    );
    if (existing.rows.length) {
      await pool.query(
        "UPDATE GioHang_Online SET SoLuong=SoLuong+$1 WHERE ID=$2",
        [SoLuong, existing.rows[0].id],
      );
    } else {
      await pool.query(
        "INSERT INTO GioHang_Online (CustomerID, MaSanPham, SoLuong, Size, MauSac) VALUES ($1,$2,$3,$4,$5)",
        [req.user.id, MaSanPham, SoLuong, Size || "", MauSac || ""],
      );
    }
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// PUT /api/giohang/:id — Cập nhật số lượng
app.put("/api/giohang/:id", requireLogin, async (req, res) => {
  if (req.user.type !== "customer")
    return res.status(403).json({ error: "Chỉ dành cho khách hàng" });
  try {
    const { SoLuong } = req.body;
    if (SoLuong < 1)
      return res.status(400).json({ error: "Số lượng không hợp lệ" });
    // Chỉ cho phép sửa giỏ của chính mình
    await pool.query(
      "UPDATE GioHang_Online SET SoLuong=$1 WHERE ID=$2 AND CustomerID=$3",
      [SoLuong, req.params.id, req.user.id],
    );
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// DELETE /api/giohang/:id — Xóa item
app.delete("/api/giohang/:id", requireLogin, async (req, res) => {
  if (req.user.type !== "customer")
    return res.status(403).json({ error: "Chỉ dành cho khách hàng" });
  try {
    await pool.query(
      "DELETE FROM GioHang_Online WHERE ID=$1 AND CustomerID=$2",
      [req.params.id, req.user.id],
    );
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ============================================================
// ĐƠN HÀNG — khách đặt hàng
// ============================================================

// POST /api/donhang — Đặt hàng
// Khách đăng nhập: dùng CustomerID từ token
// Khách vãn lai: truyền thông tin giao hàng, KHÔNG lưu tài khoản
app.post("/api/donhang", async (req, res) => {
  try {
    const {
      items,
      HoTenNguoiNhan,
      SoDienThoaiNhan,
      DiaChiGiao,
      GhiChu,
      PhuongThucTT,
    } = req.body;
    if (!items || !items.length)
      return res.status(400).json({ error: "Giỏ hàng trống" });
    if (!HoTenNguoiNhan || !SoDienThoaiNhan || !DiaChiGiao)
      return res.status(400).json({ error: "Thiếu thông tin giao hàng" });

    // Xác định CustomerID: nếu là khách đăng nhập thì dùng ID từ token
    let customerID = null;
    if (req.user && req.user.type === "customer") {
      customerID = req.user.id;
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Tính tổng tiền + kiểm tra tồn kho
      let tongTien = 0;
      for (const item of items) {
        const sp = await client.query(
          "SELECT GiaBan, SoLuongTon FROM SanPham WHERE MaSanPham=$1 AND TinhTrang!='Ẩn'",
          [item.MaSanPham],
        );
        if (!sp.rows.length)
          throw new Error(`Sản phẩm ${item.MaSanPham} không tồn tại`);
        if (sp.rows[0].soLuongTon < item.SoLuong)
          throw new Error(`${item.MaSanPham} không đủ hàng`);
        tongTien += parseFloat(sp.rows[0].giaban) * item.SoLuong;
      }

      // Tạo mã hóa đơn
      const maHD = "HD" + Date.now();
      const hdResult = await client.query(
        `INSERT INTO HoaDonBanHang
           (MaHoaDon, CustomerID, HoTenNguoiNhan, SoDienThoaiNhan, DiaChiGiao, GhiChu, TongTien, TrangThai, PhuongThucTT, NgayBan)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'Chờ xử lý',$8,NOW()) RETURNING *`,
        [
          maHD,
          customerID,
          HoTenNguoiNhan,
          SoDienThoaiNhan,
          DiaChiGiao,
          GhiChu || "",
          tongTien,
          PhuongThucTT || "Tiền mặt",
        ],
      );

      // Thêm chi tiết + trừ kho
      for (const item of items) {
        const sp = await client.query(
          "SELECT GiaBan FROM SanPham WHERE MaSanPham=$1",
          [item.MaSanPham],
        );
        await client.query(
          "INSERT INTO CHI_TIET_HOA_DON (MaHoaDon, MaSanPham, SoLuong, DonGia, Size, MauSac) VALUES ($1,$2,$3,$4,$5,$6)",
          [
            maHD,
            item.MaSanPham,
            item.SoLuong,
            sp.rows[0].giaban,
            item.Size || "",
            item.MauSac || "",
          ],
        );
        await client.query(
          "UPDATE SanPham SET SoLuongTon=SoLuongTon-$1 WHERE MaSanPham=$2",
          [item.SoLuong, item.MaSanPham],
        );
      }

      // Xóa giỏ hàng nếu là khách đăng nhập
      if (customerID) {
        await client.query("DELETE FROM GioHang_Online WHERE CustomerID=$1", [
          customerID,
        ]);
      }

      await client.query("COMMIT");
      res.json({
        success: true,
        maHoaDon: maHD,
        tongTien,
        data: hdResult.rows[0],
      });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// GET /api/donhang/cua-toi — Lịch sử đơn của khách đăng nhập
app.get("/api/donhang/cua-toi", requireLogin, async (req, res) => {
  if (req.user.type !== "customer")
    return res.status(403).json({ error: "Chỉ dành cho khách hàng" });
  try {
    const r = await pool.query(
      `SELECT h.*, array_agg(json_build_object('ten', s.TenSanPham, 'sl', ct.SoLuong, 'gia', ct.DonGia)) as items
       FROM HoaDonBanHang h
       LEFT JOIN CHI_TIET_HOA_DON ct ON h.MaHoaDon = ct.MaHoaDon
       LEFT JOIN SanPham s ON ct.MaSanPham = s.MaSanPham
       WHERE h.CustomerID = $1
       GROUP BY h.MaHoaDon ORDER BY h.NgayBan DESC LIMIT 50`,
      [req.user.id],
    );
    res.json(r.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// THANH TOÁN — công khai (khách vãn lai & đăng nhập đều dùng được)
// ============================================================

const pendingPayments = new Map();

app.post("/api/payment/init", (req, res) => {
  const { amount } = req.body;
  if (!amount || amount <= 0)
    return res.status(400).json({ error: "Số tiền không hợp lệ" });

  const ref = "SVN" + Math.floor(100000 + Math.random() * 900000);
  const expiresAt = Date.now() + 10 * 60 * 1000;

  pendingPayments.set(ref, {
    amount: parseInt(amount),
    createdAt: Date.now(),
    expiresAt,
    verified: false,
    txnData: null,
  });

  const qrUrl =
    `https://img.vietqr.io/image/MB-1803042005-compact2.jpg` +
    `?amount=${amount}&addInfo=${encodeURIComponent(ref)}&accountName=${encodeURIComponent("HA THI THU PHUONG")}`;

  res.json({ ref, qrUrl, expiresAt });
});

app.get("/api/payment/check", async (req, res) => {
  const { ref } = req.query;
  if (!ref) return res.status(400).json({ error: "Thiếu ref" });

  const session = pendingPayments.get(ref);
  if (!session)
    return res.status(404).json({ error: "Không tìm thấy phiên thanh toán" });
  if (Date.now() > session.expiresAt) {
    pendingPayments.delete(ref);
    return res.json({ status: "expired" });
  }
  if (session.verified)
    return res.json({ status: "verified", txn: session.txnData });

  const CASSO_KEY = process.env.CASSO_API_KEY;
  if (!CASSO_KEY) return res.json({ status: "pending", reason: "no_api_key" });

  try {
    const today = new Date().toISOString().split("T")[0];
    const cassoRes = await fetch(
      `https://oauth.casso.vn/v2/transactions?page=1&pageSize=20&fromDate=${today}`,
      {
        headers: {
          Authorization: `Apikey ${CASSO_KEY}`,
          "Content-Type": "application/json",
        },
      },
    );
    if (!cassoRes.ok)
      return res.json({ status: "pending", reason: "api_error" });

    const cassoData = await cassoRes.json();
    const records = cassoData?.data?.records || [];
    const match = records.find((t) => {
      const content = (t.description || "").toUpperCase();
      return (
        content.includes(ref.toUpperCase()) &&
        parseInt(t.amount || 0) >= session.amount * 0.99
      );
    });

    if (match) {
      session.verified = true;
      session.txnData = {
        ref,
        amount: parseInt(match.amount),
        description: match.description,
        txnId: match.id || match.tid || "—",
        when: match.when || new Date().toISOString(),
        bank: "MB Bank",
      };
      pendingPayments.set(ref, session);
      return res.json({ status: "verified", txn: session.txnData });
    }
    return res.json({ status: "pending" });
  } catch (err) {
    return res.json({ status: "pending", reason: "fetch_error" });
  }
});

app.post("/api/payment/manual-confirm", (req, res) => {
  const { ref, manualCode } = req.body;
  if (!ref || !manualCode)
    return res.status(400).json({ error: "Thiếu ref hoặc manualCode" });
  const session = pendingPayments.get(ref);
  if (!session) return res.status(404).json({ error: "Không tìm thấy phiên" });
  session.verified = true;
  session.txnData = {
    ref,
    amount: session.amount,
    description: ref,
    txnId: manualCode,
    when: new Date().toISOString(),
    bank: "MB Bank (thủ công)",
  };
  pendingPayments.set(ref, session);
  res.json({ success: true, txn: session.txnData });
});

setInterval(
  () => {
    const now = Date.now();
    for (const [ref, s] of pendingPayments.entries()) {
      if (now > s.expiresAt + 60000) pendingPayments.delete(ref);
    }
  },
  15 * 60 * 1000,
);

// ============================================================
// ADMIN ROUTES — yêu cầu JWT hợp lệ + role
// Tất cả routes /api/admin/* và /api/ketoan/* đều được bảo vệ
// ============================================================

// ── SẢN PHẨM (admin/shop) ────────────────────────────────────
app.get(
  "/api/admin/sanpham",
  requireRole("shop", "admin"),
  async (req, res) => {
    try {
      const {
        search,
        danhmuc,
        thuonghieu,
        tinhtrang,
        page = 1,
        limit = 20,
      } = req.query;
      let q = "SELECT * FROM SanPham WHERE 1=1";
      const p = [];
      if (search) {
        p.push(`%${search}%`);
        q += ` AND (TenSanPham ILIKE $${p.length} OR MaSanPham ILIKE $${p.length} OR SKU ILIKE $${p.length})`;
      }
      if (danhmuc) {
        p.push(danhmuc);
        q += ` AND DanhMuc = $${p.length}`;
      }
      if (thuonghieu) {
        p.push(thuonghieu);
        q += ` AND ThuongHieu = $${p.length}`;
      }
      if (tinhtrang) {
        p.push(tinhtrang);
        q += ` AND TinhTrang = $${p.length}`;
      }
      q += ` ORDER BY TenSanPham LIMIT $${p.length + 1} OFFSET $${p.length + 2}`;
      p.push(parseInt(limit), (parseInt(page) - 1) * parseInt(limit));
      const [rows, cnt] = await Promise.all([
        pool.query(q, p),
        pool.query("SELECT COUNT(*) FROM SanPham"),
      ]);
      res.json({ data: rows.rows, total: parseInt(cnt.rows[0].count) });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  },
);

app.post(
  "/api/admin/sanpham",
  requireRole("shop", "admin"),
  async (req, res) => {
    try {
      const {
        MaSanPham,
        TenSanPham,
        ThuongHieu,
        DanhMuc,
        GiaNhap,
        GiaBan,
        Size,
        MauSac,
        MoTaSanPham,
        ChinhSachDoiTra,
        ChinhSachBaoHanh,
        TinhTrang,
        SoLuongTon,
        SKU,
      } = req.body;
      if (!MaSanPham || !TenSanPham)
        return res
          .status(400)
          .json({ error: "Thiếu MaSanPham hoặc TenSanPham" });
      const r = await pool.query(
        `INSERT INTO SanPham (MaSanPham,TenSanPham,ThuongHieu,DanhMuc,GiaNhap,GiaBan,Size,MauSac,MoTaSanPham,ChinhSachDoiTra,ChinhSachBaoHanh,TinhTrang,SoLuongTon,SKU)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
        [
          MaSanPham,
          TenSanPham,
          ThuongHieu || "",
          DanhMuc || "",
          GiaNhap || null,
          GiaBan || null,
          Size || "",
          MauSac || "",
          MoTaSanPham || "",
          ChinhSachDoiTra || "",
          ChinhSachBaoHanh || "",
          TinhTrang || "Đang bán",
          SoLuongTon || 0,
          SKU || "",
        ],
      );
      res.json({ success: true, data: r.rows[0] });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  },
);

app.put(
  "/api/admin/sanpham/:ma",
  requireRole("shop", "admin"),
  async (req, res) => {
    try {
      const fields = req.body;
      const keys = Object.keys(fields),
        vals = Object.values(fields);
      if (!keys.length)
        return res.status(400).json({ error: "Không có dữ liệu" });
      const set = keys.map((k, i) => `${k} = $${i + 1}`).join(", ");
      vals.push(req.params.ma);
      const r = await pool.query(
        `UPDATE SanPham SET ${set} WHERE MaSanPham = $${vals.length} RETURNING *`,
        vals,
      );
      if (!r.rows.length)
        return res.status(404).json({ error: "Không tìm thấy" });
      res.json({ success: true, data: r.rows[0] });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  },
);

app.delete(
  "/api/admin/sanpham/:ma",
  requireRole("shop", "admin"),
  async (req, res) => {
    try {
      const r = await pool.query(
        "DELETE FROM SanPham WHERE MaSanPham = $1 RETURNING MaSanPham",
        [req.params.ma],
      );
      if (!r.rows.length)
        return res.status(404).json({ error: "Không tìm thấy" });
      res.json({ success: true });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  },
);

app.patch(
  "/api/admin/sanpham/:ma/toggle",
  requireRole("shop", "admin"),
  async (req, res) => {
    try {
      const r = await pool.query(
        "SELECT TinhTrang FROM SanPham WHERE MaSanPham=$1",
        [req.params.ma],
      );
      if (!r.rows.length)
        return res.status(404).json({ error: "Không tìm thấy" });
      const next = r.rows[0].tinhtrang === "Ẩn" ? "Đang bán" : "Ẩn";
      const upd = await pool.query(
        "UPDATE SanPham SET TinhTrang=$1 WHERE MaSanPham=$2 RETURNING *",
        [next, req.params.ma],
      );
      res.json({ success: true, data: upd.rows[0] });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  },
);

// ── IMPORT EXCEL (admin/shop) ─────────────────────────────
app.post(
  "/api/admin/sanpham/import",
  requireRole("shop", "admin"),
  upload.single("file"),
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "Không có file" });
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(req.file.buffer);
      const worksheet = workbook.worksheets[0];
      const headers = [];
      worksheet.getRow(1).eachCell((cell) => headers.push(cell.value));
      const rows = [];
      worksheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        const obj = {};
        row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
          const key = headers[colNumber - 1];
          if (key) obj[key] = cell.value ?? "";
        });
        rows.push(obj);
      });

      const REQUIRED = ["MaSanPham", "TenSanPham"];
      const results = { success: [], errors: [], warnings: [] };
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        for (const [idx, row] of rows.entries()) {
          const lineNum = idx + 2;
          const missing = REQUIRED.filter((f) => !row[f]);
          if (missing.length) {
            results.errors.push({
              line: lineNum,
              reason: `Thiếu: ${missing.join(", ")}`,
            });
            continue;
          }
          const existing = await client.query(
            "SELECT MaSanPham FROM SanPham WHERE MaSanPham = $1",
            [row.MaSanPham],
          );
          if (existing.rows.length) {
            results.warnings.push({
              line: lineNum,
              reason: `${row.MaSanPham} đã tồn tại`,
            });
            continue;
          }
          await client.query(
            `INSERT INTO SanPham (MaSanPham,TenSanPham,ThuongHieu,DanhMuc,GiaNhap,GiaBan,Size,MauSac,MoTaSanPham,ChinhSachDoiTra,ChinhSachBaoHanh,TinhTrang,SoLuongTon,SKU)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
            [
              row.MaSanPham,
              row.TenSanPham,
              row.ThuongHieu || "",
              row.DanhMuc || "",
              parseFloat(row.GiaNhap) || null,
              parseFloat(row.GiaBan) || null,
              row.Size || "",
              row.MauSac || "",
              row.MoTaSanPham || "",
              row.ChinhSachDoiTra || "",
              row.ChinhSachBaoHanh || "",
              row.TinhTrang || "Đang bán",
              parseInt(row.SoLuongTon) || 0,
              row.SKU || "",
            ],
          );
          results.success.push({ line: lineNum, MaSanPham: row.MaSanPham });
        }
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
      res.json({
        imported: results.success.length,
        skipped: results.warnings.length,
        failed: results.errors.length,
        details: results,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  },
);

// ── ĐƠN HÀNG (admin/shop/accountant) ────────────────────────
app.get(
  "/api/admin/hoadon",
  requireRole("shop", "admin", "accountant"),
  async (req, res) => {
    try {
      const { status, page = 1, limit = 20, search } = req.query;
      let q = `SELECT h.*, k.HoTen as TenKhachHang, k.SoDienThoai FROM HoaDonBanHang h LEFT JOIN KhachHang k ON h.CustomerID = k.CustomerID WHERE 1=1`;
      const p = [];
      if (status) {
        p.push(status);
        q += ` AND h.TrangThai = $${p.length}`;
      }
      if (search) {
        p.push(`%${search}%`);
        q += ` AND (h.MaHoaDon ILIKE $${p.length} OR k.HoTen ILIKE $${p.length})`;
      }
      q += ` ORDER BY h.NgayBan DESC LIMIT $${p.length + 1} OFFSET $${p.length + 2}`;
      p.push(parseInt(limit), (parseInt(page) - 1) * parseInt(limit));
      const [rows, cnt] = await Promise.all([
        pool.query(q, p),
        pool.query("SELECT COUNT(*) FROM HoaDonBanHang"),
      ]);
      res.json({ data: rows.rows, total: parseInt(cnt.rows[0].count) });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  },
);

app.put(
  "/api/admin/hoadon/:ma/status",
  requireRole("shop", "admin"),
  async (req, res) => {
    try {
      const { TrangThai } = req.body;
      const valid = [
        "Chờ xử lý",
        "Đã xác nhận",
        "Đang giao",
        "Hoàn thành",
        "Đã hủy",
        "Hoàn trả",
      ];
      if (!valid.includes(TrangThai))
        return res.status(400).json({ error: "Trạng thái không hợp lệ" });
      const r = await pool.query(
        "UPDATE HoaDonBanHang SET TrangThai=$1 WHERE MaHoaDon=$2 RETURNING *",
        [TrangThai, req.params.ma],
      );
      if (!r.rows.length)
        return res.status(404).json({ error: "Không tìm thấy" });
      res.json({ success: true, data: r.rows[0] });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  },
);

app.delete("/api/admin/hoadon/:ma", requireRole("admin"), async (req, res) => {
  try {
    await pool.query("DELETE FROM CHI_TIET_HOA_DON WHERE MaHoaDon=$1", [
      req.params.ma,
    ]);
    await pool.query("DELETE FROM HoaDonBanHang WHERE MaHoaDon=$1", [
      req.params.ma,
    ]);
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ── KHÁCH HÀNG (admin/shop/accountant) ───────────────────────
app.get(
  "/api/admin/khachhang",
  requireRole("shop", "admin", "accountant"),
  async (req, res) => {
    try {
      const { search, page = 1, limit = 20 } = req.query;
      let q =
        "SELECT CustomerID,HoTen,Email,SoDienThoai,DiaChi,NgayTao FROM KhachHang WHERE 1=1";
      const p = [];
      if (search) {
        p.push(`%${search}%`);
        q += ` AND (HoTen ILIKE $${p.length} OR Email ILIKE $${p.length} OR SoDienThoai ILIKE $${p.length})`;
      }
      q += ` ORDER BY NgayTao DESC LIMIT $${p.length + 1} OFFSET $${p.length + 2}`;
      p.push(parseInt(limit), (parseInt(page) - 1) * parseInt(limit));
      const [rows, cnt] = await Promise.all([
        pool.query(q, p),
        pool.query("SELECT COUNT(*) FROM KhachHang"),
      ]);
      res.json({ data: rows.rows, total: parseInt(cnt.rows[0].count) });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  },
);

app.delete(
  "/api/admin/khachhang/:id",
  requireRole("admin"),
  async (req, res) => {
    try {
      await pool.query("DELETE FROM KhachHang WHERE CustomerID=$1", [
        req.params.id,
      ]);
      res.json({ success: true });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  },
);

// ── DANH MỤC (admin) ─────────────────────────────────────────
app.post("/api/admin/danhmuc", requireRole("admin"), async (req, res) => {
  try {
    const { Ten, Ma, Mota, TrangThai } = req.body;
    if (!Ten) return res.status(400).json({ error: "Tên không được trống" });
    const r = await pool.query(
      "INSERT INTO DanhMuc (Ten,Ma,Mota,TrangThai) VALUES ($1,$2,$3,$4) RETURNING *",
      [Ten, Ma || "", Mota || "", TrangThai || "Hoat dong"],
    );
    res.json({ success: true, data: r.rows[0] });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.put("/api/admin/danhmuc/:id", requireRole("admin"), async (req, res) => {
  try {
    const { Ten, Ma, Mota, TrangThai } = req.body;
    const r = await pool.query(
      "UPDATE DanhMuc SET Ten=$1,Ma=$2,Mota=$3,TrangThai=$4 WHERE ID=$5 RETURNING *",
      [Ten, Ma, Mota, TrangThai, req.params.id],
    );
    res.json({ success: true, data: r.rows[0] });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete("/api/admin/danhmuc/:id", requireRole("admin"), async (req, res) => {
  try {
    await pool.query("DELETE FROM DanhMuc WHERE ID=$1", [req.params.id]);
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ── KẾ TOÁN — PHIẾU THU / PHIẾU CHI ─────────────────────────
// Tất cả đều require JWT với role=accountant hoặc admin

app.get(
  "/api/ketoan/phieuthu",
  requireRole("accountant", "admin"),
  async (req, res) => {
    try {
      const r = await pool.query(
        `SELECT pt.*, k.HoTen, nq.HoTen as TenNguoiThu
       FROM PhieuThu pt
       LEFT JOIN KhachHang k ON pt.CustomerID=k.CustomerID
       LEFT JOIN NguoiQuanLy nq ON pt.IDNguoiQuanLy=nq.IDNguoiQuanLy
       ORDER BY pt.NgayThu DESC LIMIT 100`,
      );
      res.json(r.rows);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  },
);

app.post(
  "/api/ketoan/phieuthu",
  requireRole("accountant", "admin"),
  async (req, res) => {
    try {
      const { MaPhieuThu, CustomerID, SoTienThu, GhiChu, PaymentMethodID } =
        req.body;
      if (!MaPhieuThu || !SoTienThu)
        return res.status(400).json({ error: "Thiếu mã phiếu hoặc số tiền" });
      const IDNguoiQuanLy = req.user.id; // Lấy từ JWT, không nhận từ body
      const r = await pool.query(
        `INSERT INTO PhieuThu (MaPhieuThu,IDNguoiQuanLy,CustomerID,SoTienThu,GhiChu,TrangThai,PaymentMethodID,NgayThu)
       VALUES ($1,$2,$3,$4,$5,'Đã thu',$6,NOW()) RETURNING *`,
        [
          MaPhieuThu,
          IDNguoiQuanLy,
          CustomerID || null,
          SoTienThu,
          GhiChu || "",
          PaymentMethodID || null,
        ],
      );
      res.json({ success: true, data: r.rows[0] });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  },
);

app.get(
  "/api/ketoan/phieuchi",
  requireRole("accountant", "admin"),
  async (req, res) => {
    try {
      const r = await pool.query(
        `SELECT pc.*, n.TenNhaCungCap, nq.HoTen as TenNguoiChi
       FROM PhieuChi pc
       LEFT JOIN NhaCungCap n ON pc.SupplierID=n.SupplierID
       LEFT JOIN NguoiQuanLy nq ON pc.IDNguoiQuanLy=nq.IDNguoiQuanLy
       ORDER BY pc.NgayChi DESC LIMIT 100`,
      );
      res.json(r.rows);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  },
);

app.post(
  "/api/ketoan/phieuchi",
  requireRole("accountant", "admin"),
  async (req, res) => {
    try {
      const { MaPhieuChi, SupplierID, SoTienChi, GhiChu, PaymentMethodID } =
        req.body;
      if (!MaPhieuChi || !SoTienChi)
        return res.status(400).json({ error: "Thiếu mã phiếu hoặc số tiền" });
      const IDNguoiQuanLy = req.user.id; // Lấy từ JWT
      const r = await pool.query(
        `INSERT INTO PhieuChi (MaPhieuChi,IDNguoiQuanLy,SupplierID,SoTienChi,GhiChu,TrangThai,PaymentMethodID,NgayChi)
       VALUES ($1,$2,$3,$4,$5,'Chờ duyệt',$6,NOW()) RETURNING *`,
        [
          MaPhieuChi,
          IDNguoiQuanLy,
          SupplierID || null,
          SoTienChi,
          GhiChu || "",
          PaymentMethodID || null,
        ],
      );
      res.json({ success: true, data: r.rows[0] });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  },
);

app.put(
  "/api/ketoan/phieuchi/:ma/approve",
  requireRole("accountant", "admin"),
  async (req, res) => {
    try {
      const r = await pool.query(
        "UPDATE PhieuChi SET TrangThai='Đã duyệt' WHERE MaPhieuChi=$1 RETURNING *",
        [req.params.ma],
      );
      res.json({ success: true, data: r.rows[0] });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  },
);

// ── THỐNG KÊ MỞ RỘNG (staff only) ───────────────────────────
app.get(
  "/api/admin/thongke",
  requireRole("shop", "admin", "accountant"),
  async (req, res) => {
    try {
      const [sp, kh, hd, het, tk] = await Promise.all([
        pool.query("SELECT COUNT(*) FROM SanPham"),
        pool.query("SELECT COUNT(*) FROM KhachHang"),
        pool.query(
          "SELECT COUNT(*) as total, COALESCE(SUM(TongTien),0) as doanhthu FROM HoaDonBanHang",
        ),
        pool.query("SELECT COUNT(*) FROM SanPham WHERE SoLuongTon = 0"),
        pool.query(
          "SELECT TrangThai, COUNT(*) as cnt FROM HoaDonBanHang GROUP BY TrangThai",
        ),
      ]);
      res.json({
        tongSanPham: parseInt(sp.rows[0].count),
        tongKhachHang: parseInt(kh.rows[0].count),
        tongHoaDon: parseInt(hd.rows[0].total),
        doanhThu: parseFloat(hd.rows[0].doanhthu),
        hetHang: parseInt(het.rows[0].count),
        theoTrangThai: Object.fromEntries(
          tk.rows.map((r) => [r.trangthai, parseInt(r.cnt)]),
        ),
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  },
);

// ── QUẢN LÝ NGƯỜI DÙNG (super admin) ─────────────────────────
app.get("/api/admin/users", requireRole("admin"), async (req, res) => {
  try {
    const r = await pool.query(
      "SELECT IDNguoiQuanLy,HoTen,Email,SoDienThoai,VaiTro,TrangThai,NgayTao FROM NguoiQuanLy ORDER BY NgayTao DESC",
    );
    res.json(r.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/admin/users", requireRole("admin"), async (req, res) => {
  try {
    const { HoTen, Email, SoDienThoai, MatKhau, VaiTro } = req.body;
    if (!HoTen || !Email || !MatKhau)
      return res
        .status(400)
        .json({ error: "Thiếu họ tên, email hoặc mật khẩu" });
    const hashedPw = crypto
      .createHash("sha256")
      .update(MatKhau + JWT_SECRET)
      .digest("hex");
    const r = await pool.query(
      `INSERT INTO NguoiQuanLy (HoTen,Email,SoDienThoai,MatKhau,VaiTro,TrangThai,NgayTao)
       VALUES ($1,$2,$3,$4,$5,'Hoạt động',NOW()) RETURNING IDNguoiQuanLy,HoTen,Email,VaiTro,TrangThai`,
      [HoTen, Email, SoDienThoai || "", hashedPw, VaiTro || "shop"],
    );
    res.json({ success: true, data: r.rows[0] });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.put("/api/admin/users/:id", requireRole("admin"), async (req, res) => {
  try {
    const { HoTen, Email, SoDienThoai, VaiTro, TrangThai } = req.body;
    const r = await pool.query(
      "UPDATE NguoiQuanLy SET HoTen=$1,Email=$2,SoDienThoai=$3,VaiTro=$4,TrangThai=$5 WHERE IDNguoiQuanLy=$6 RETURNING IDNguoiQuanLy,HoTen,Email,VaiTro,TrangThai",
      [HoTen, Email, SoDienThoai, VaiTro, TrangThai, req.params.id],
    );
    res.json({ success: true, data: r.rows[0] });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete("/api/admin/users/:id", requireRole("admin"), async (req, res) => {
  try {
    if (req.user.id == req.params.id)
      return res.status(400).json({ error: "Không thể xóa chính mình" });
    await pool.query("DELETE FROM NguoiQuanLy WHERE IDNguoiQuanLy=$1", [
      req.params.id,
    ]);
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ── NHÀ CUNG CẤP (admin) ─────────────────────────────────────
app.post(
  "/api/admin/nhacungcap",
  requireRole("admin", "shop"),
  async (req, res) => {
    try {
      const { TenNhaCungCap, SoDienThoai, Email, DiaChi } = req.body;
      if (!TenNhaCungCap)
        return res
          .status(400)
          .json({ error: "Tên nhà cung cấp không được trống" });
      const r = await pool.query(
        "INSERT INTO NhaCungCap (TenNhaCungCap,SoDienThoai,Email,DiaChi) VALUES ($1,$2,$3,$4) RETURNING *",
        [TenNhaCungCap, SoDienThoai || "", Email || "", DiaChi || ""],
      );
      res.json({ success: true, data: r.rows[0] });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  },
);

// ============================================================
// CHAT AI — Dùng Anthropic API để trả lời khách hàng tự động
// Bảng: Chat_Sessions, Chat_Messages (tạo tự động nếu chưa có)
// Env: ANTHROPIC_API_KEY
// ============================================================

(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS Chat_Sessions (
        id          SERIAL PRIMARY KEY,
        guest_name  VARCHAR(100) DEFAULT 'Khách',
        guest_email VARCHAR(200) DEFAULT '',
        status      VARCHAR(20)  DEFAULT 'open',
        created_at  TIMESTAMP    DEFAULT NOW(),
        updated_at  TIMESTAMP    DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS Chat_Messages (
        id         SERIAL PRIMARY KEY,
        session_id INT          NOT NULL REFERENCES Chat_Sessions(id) ON DELETE CASCADE,
        sender     VARCHAR(20)  NOT NULL,
        message    TEXT         NOT NULL,
        created_at TIMESTAMP    DEFAULT NOW()
      );
    `);
  } catch(e) { console.error('Chat table init:', e.message); }
})();

// POST /api/chat/session — Khách tạo phiên chat mới
app.post('/api/chat/session', async (req, res) => {
  try {
    const { guest_name, guest_email } = req.body;
    const r = await pool.query(
      `INSERT INTO Chat_Sessions (guest_name, guest_email) VALUES ($1,$2) RETURNING *`,
      [guest_name || 'Khách', guest_email || '']
    );
    res.json({ success: true, session: r.rows[0] });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /api/chat/session/:id/messages
app.get('/api/chat/session/:id/messages', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT * FROM Chat_Messages WHERE session_id=$1 ORDER BY created_at ASC`,
      [req.params.id]
    );
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/chat/message — Khách gửi tin, AI trả lời ngay
app.post('/api/chat/message', async (req, res) => {
  try {
    const { session_id, message } = req.body;
    if (!session_id || !message?.trim())
      return res.status(400).json({ error: 'Thiếu session_id hoặc message' });

    // Lưu tin nhắn của khách
    await pool.query(
      `INSERT INTO Chat_Messages (session_id, sender, message) VALUES ($1,'guest',$2)`,
      [session_id, message.trim()]
    );
    await pool.query(
      `UPDATE Chat_Sessions SET updated_at=NOW() WHERE id=$1`, [session_id]
    );

    // Lấy lịch sử hội thoại (tối đa 10 tin gần nhất)
    const histRes = await pool.query(
      `SELECT sender, message FROM Chat_Messages WHERE session_id=$1 ORDER BY created_at DESC LIMIT 10`,
      [session_id]
    );
    const history = histRes.rows.reverse();

    // Lấy một số sản phẩm từ DB để AI biết context
    const prodRes = await pool.query(
      `SELECT TenSanPham as ten, ThuongHieu as hang, GiaBan as gia, SoLuongTon as ton, TinhTrang as tt, DanhMuc as dm
       FROM SanPham WHERE TinhTrang != 'Ẩn' ORDER BY TenSanPham LIMIT 30`
    );
    const products = prodRes.rows;
    const productList = products.map(p =>
      `- ${p.ten} (${p.hang}) | Giá: ${Number(p.gia).toLocaleString('vi-VN')}đ | Tồn: ${p.ton} | Danh mục: ${p.dm}`
    ).join('\n');

    // Gọi Gemini API (miễn phí) hoặc fallback Anthropic nếu có
    const GEMINI_KEY    = process.env.GEMINI_API_KEY;
    const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

    if (!GEMINI_KEY && !ANTHROPIC_KEY) {
      const fallback = 'Xin chào! Hiện tại hệ thống AI chưa được cấu hình. Vui lòng liên hệ shop qua hotline để được hỗ trợ nhé!';
      await pool.query(
        `INSERT INTO Chat_Messages (session_id, sender, message) VALUES ($1,'ai',$2)`,
        [session_id, fallback]
      );
      return res.json({ reply: fallback });
    }

    const systemPrompt = `Bạn là trợ lý tư vấn bán hàng của SneakerVN — shop giày sneaker chính hãng.
Nhiệm vụ: Tư vấn sản phẩm, giải đáp thắc mắc, hỗ trợ đặt hàng cho khách hàng.
Phong cách: Thân thiện, nhiệt tình, chuyên nghiệp. Dùng tiếng Việt.
Trả lời ngắn gọn, dưới 150 từ. Không dùng markdown.

Danh sách sản phẩm hiện có:
${productList}

Nếu khách hỏi sản phẩm không có trong danh sách, hãy gợi ý sản phẩm tương tự hoặc báo sẽ kiểm tra thêm.`;

    let reply = '';

    if (GEMINI_KEY) {
      // ── Gemini API (miễn phí) ──────────────────────────────
      // Chuyển history sang format Gemini
      const geminiContents = history.map(m => ({
        role: m.sender === 'guest' ? 'user' : 'model',
        parts: [{ text: m.message }]
      }));
      // Đảm bảo bắt đầu bằng user
      if (geminiContents.length === 0 || geminiContents[0].role !== 'user') {
        geminiContents.unshift({ role: 'user', parts: [{ text: message.trim() }] });
      }
      // Gemini không cho phép kết thúc bằng 'model', phải kết thúc bằng 'user'
      if (geminiContents[geminiContents.length - 1].role === 'model') {
        geminiContents.push({ role: 'user', parts: [{ text: message.trim() }] });
      }

      const geminiRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: systemPrompt }] },
            contents: geminiContents,
            generationConfig: { maxOutputTokens: 400, temperature: 0.7 }
          })
        }
      );
      const geminiData = await geminiRes.json();
      if (geminiData.error) {
        console.error('Gemini error:', geminiData.error);
        reply = 'Xin lỗi, tôi đang gặp sự cố kỹ thuật. Vui lòng thử lại sau!';
      } else {
        reply = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text
          || 'Xin lỗi, tôi không thể trả lời lúc này. Vui lòng thử lại.';
      }

    } else {
      // ── Anthropic API (fallback) ───────────────────────────
      const messages = history.map(m => ({
        role: m.sender === 'guest' ? 'user' : 'assistant',
        content: m.message
      }));
      if (messages.length === 0 || messages[0].role !== 'user') {
        messages.unshift({ role: 'user', content: message.trim() });
      }
      const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 500,
          system: systemPrompt,
          messages
        })
      });
      const aiData = await aiRes.json();
      reply = aiData?.content?.[0]?.text || 'Xin lỗi, tôi không thể trả lời lúc này. Vui lòng thử lại.';
    }

    // Lưu tin nhắn AI
    await pool.query(
      `INSERT INTO Chat_Messages (session_id, sender, message) VALUES ($1,'ai',$2)`,
      [session_id, reply]
    );
    await pool.query(
      `UPDATE Chat_Sessions SET updated_at=NOW() WHERE id=$1`, [session_id]
    );

    res.json({ reply });
  } catch(e) {
    console.error('Chat AI error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/admin/chat/sessions — Admin xem tất cả phiên
app.get('/api/admin/chat/sessions', requireRole('shop','admin'), async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT s.*,
        (SELECT COUNT(*) FROM Chat_Messages m WHERE m.session_id=s.id) as msg_count,
        (SELECT message FROM Chat_Messages m WHERE m.session_id=s.id ORDER BY created_at DESC LIMIT 1) as last_message
      FROM Chat_Sessions s
      ORDER BY s.updated_at DESC
    `);
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/admin/chat/session/:id/close
app.put('/api/admin/chat/session/:id/close', requireRole('shop','admin'), async (req, res) => {
  try {
    await pool.query(`UPDATE Chat_Sessions SET status='closed' WHERE id=$1`, [req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Fallback HTML
app.get("*", (req, res) => {
  if (!req.path.startsWith("/api")) {
    res.sendFile("index.html", { root: "." });
  }
});

// ── Khởi động server ─────────────────────────────────────────
const PORT = process.env.PORT || 8080;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Server SneakerVN tại http://0.0.0.0:${PORT}`);
  console.log(`   ⚠️  Nhớ set JWT_SECRET trong biến môi trường Replit!`);
});
process.env.NODE_ENV = 'production';