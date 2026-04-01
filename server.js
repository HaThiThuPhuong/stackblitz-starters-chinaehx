import dotenv from "dotenv";
dotenv.config();

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
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const { Pool } = pkg;
const app = express();
const upload = multer({ storage: multer.memoryStorage() });

// ── __dirname cho ESM ────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ── Thư mục lưu ảnh sản phẩm ────────────────────────────────
const UPLOADS_DIR = path.join(__dirname, "uploads", "products");
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// ── Kết nối Database ────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DISABLE_SSL === 'true'
    ? false
    : { rejectUnauthorized: false },
});

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static("."));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

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

// ── KIỂM TRA KẾT NỐI SUPABASE STORAGE ───────────────────────
app.get("/api/admin/storage-check", async (req, res) => {
  try {
    const testUrl = `${SUPABASE_URL}/storage/v1/bucket/products`;
    const r = await fetch(testUrl, {
      headers: { "Authorization": `Bearer ${SUPABASE_ANON}` }
    });
    const body = await r.text();
    res.json({
      supabase_url: SUPABASE_URL,
      key_prefix: SUPABASE_ANON.substring(0, 20) + '...',
      bucket_status: r.status,
      bucket_ok: r.ok,
      bucket_response: body.substring(0, 300),
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// XÁC THỰC — KHÁCH HÀNG (đăng ký / đăng nhập)
// ============================================================

// POST /api/auth/register — Khách hàng đăng ký
app.post("/api/auth/register", async (req, res) => {
  try {
    const { hoten, email, sodienthoai, matkhau, diachi } = req.body;
    if (!hoten || !email || !matkhau)
      return res
        .status(400)
        .json({ error: "Thiếu họ tên, email hoặc mật khẩu" });

    // Kiểm tra email đã tồn tại
    const exists = await pool.query(
      "SELECT customerid FROM khachhang WHERE email=$1",
      [email],
    );
    if (exists.rows.length)
      return res.status(409).json({ error: "email đã được sử dụng" });

    const hashedPw = crypto
      .createHash("sha256")
      .update(matkhau + JWT_SECRET)
      .digest("hex");
    const r = await pool.query(
      `INSERT INTO khachhang (hoten, email, sodienthoai, diachi, matkhau, ngaytao)
       VALUES ($1,$2,$3,$4,$5,NOW()) RETURNING customerid, hoten, email, sodienthoai, diachi`,
      [hoten, email, sodienthoai || "", diachi || "", hashedPw],
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
    const { email, matkhau } = req.body;
    if (!email || !matkhau)
      return res.status(400).json({ error: "Thiếu email hoặc mật khẩu" });

    const hashedPw = crypto
      .createHash("sha256")
      .update(matkhau + JWT_SECRET)
      .digest("hex");
    const r = await pool.query(
      "SELECT customerid, hoten, email, sodienthoai, diachi FROM khachhang WHERE email=$1 AND matkhau=$2",
      [email, hashedPw],
    );
    if (!r.rows.length)
      return res.status(401).json({ error: "email hoặc mật khẩu không đúng" });

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
      "SELECT customerid, hoten, email, sodienthoai, diachi FROM khachhang WHERE customerid=$1",
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
    const { hoten, sodienthoai, diachi } = req.body;
    const r = await pool.query(
      "UPDATE khachhang SET hoten=$1, sodienthoai=$2, diachi=$3 WHERE customerid=$4 RETURNING customerid, hoten, email, sodienthoai, diachi",
      [hoten, sodienthoai, diachi, req.user.id],
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
    const { email, matkhau } = req.body;
    if (!email || !matkhau)
      return res.status(400).json({ error: "Thiếu email hoặc mật khẩu" });

    const hashedPw = crypto
      .createHash("sha256")
      .update(matkhau + JWT_SECRET)
      .digest("hex");
    const r = await pool.query(
      `SELECT idnguoiquanly, hoten, email, vaitro, trangthai FROM nguoiquanly 
       WHERE email=$1 AND matkhau=$2 AND trangthai='Hoạt động'`,
      [email, hashedPw],
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
      "SELECT masanpham,tensanpham,thuonghieu,madanhmuc,danhmuc,giaban,size,mausac,motasanpham,soluongton,sku,tinhtrang,hinhanh FROM sanpham WHERE tinhtrang != 'Ẩn'";
    const params = [];

    if (search) {
      params.push(`%${search}%`);
      query += ` AND (tensanpham ILIKE $${params.length} OR masanpham ILIKE $${params.length} OR SKU ILIKE $${params.length})`;
    }
    if (danhmuc) {
      params.push(danhmuc);
      query += ` AND danhmuc = $${params.length}`;
    }
    if (thuonghieu) {
      params.push(thuonghieu);
      query += ` AND thuonghieu = $${params.length}`;
    }

    query += ` ORDER BY tensanpham LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(parseInt(limit), (parseInt(page) - 1) * parseInt(limit));

    const [result, countResult] = await Promise.all([
      pool.query(query, params),
      pool.query("SELECT COUNT(*) FROM sanpham WHERE tinhtrang != 'Ẩn'"),
    ]);
    // KHÔNG trả gianhap cho khách hàng ngoài
    res.json({ data: result.rows, total: parseInt(countResult.rows[0].count) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Danh mục & Nhà cung cấp — công khai
// ── TÌM KIẾM BẰNG HÌNH ẢNH — Gemini Vision + Fallback ───────
app.post("/api/search/image", async (req, res) => {
  try {
    const { image } = req.body;
    if (!image) return res.status(400).json({ error: "Thiếu ảnh" });

    const GROQ_API_KEY_CHECK = process.env.GROQ_API_KEY;

    // ── Fallback: không có Groq → tìm tất cả sản phẩm đang bán ──
    if (!GROQ_API_KEY_CHECK) {
      const spRes = await pool.query(
        "SELECT masanpham, tensanpham, thuonghieu, giaban, hinhanh FROM sanpham WHERE tinhtrang != 'Ẩn' ORDER BY tensanpham LIMIT 20"
      );
      return res.json({
        query: '',
        brand: '',
        model: '',
        color: '',
        description: 'Hiển thị tất cả sản phẩm (chưa cấu hình AI API)',
        fallback: true,
        products: spRes.rows
      });
    }

    // Chuyển base64 data URL thành raw base64
    const base64 = image.replace(/^data:image\/\w+;base64,/, '');
    const mimeMatch = image.match(/^data:(image\/\w+);base64,/);
    const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';

    // Lấy danh sách thương hiệu từ DB
    const brandsRes = await pool.query(
      "SELECT DISTINCT thuonghieu as hang FROM sanpham WHERE tinhtrang != 'Ẩn' ORDER BY hang"
    );
    const brands = brandsRes.rows.map(r => r.hang).join(', ');

    // Gọi Groq Vision (llama vision)
    let rawText = '{}';
    const GROQ_KEY = process.env.GROQ_API_KEY;
    if (GROQ_KEY) {
      try {
        const visionRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + GROQ_KEY
          },
          body: JSON.stringify({
            model: 'meta-llama/llama-4-scout-17b-16e-instruct',
            max_tokens: 300,
            temperature: 0.3,
            messages: [{
              role: 'user',
              content: [
                { type: 'image_url', image_url: { url: 'data:' + mimeType + ';base64,' + base64 } },
                { type: 'text', text: 'Phân tích hình ảnh giày và trả về JSON (chỉ JSON, không giải thích):\n{"brand":"thương hiệu (chỉ chọn từ: ' + brands + ')","model":"tên model","color":"màu sắc chính","type":"loại giày","query":"từ khóa tìm kiếm tiếng Việt","description":"mô tả ngắn tiếng Việt"}' }
              ]
            }]
          })
        });
        const visionText = await visionRes.text();
        if (!visionRes.ok) {
          console.error('Groq Vision HTTP ' + visionRes.status, visionText.slice(0,200));
        } else {
          const visionData = JSON.parse(visionText);
          rawText = visionData?.choices?.[0]?.message?.content || '{}';
        }
      } catch(visionErr) {
        console.error('Groq Vision error:', visionErr.message);
      }
    }
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
    "SELECT * FROM danhmuc WHERE trangthai='Hoat dong' ORDER BY 1",
  );
  res.json(result.rows);
});

app.get("/api/nhacungcap", async (req, res) => {
  const result = await pool.query(
    "SELECT supplierid,tennhacungcap FROM nhacungcap ORDER BY tennhacungcap",
  );
  res.json(result.rows);
});

// Dashboard thống kê tóm tắt — công khai (chỉ hiển thị số đếm, không doanh thu)
app.get("/api/thongke", async (req, res) => {
  try {
    const [sanpham, hetHang] = await Promise.all([
      pool.query(
        "SELECT COUNT(*) as total FROM sanpham WHERE tinhtrang != 'Ẩn'",
      ),
      pool.query("SELECT COUNT(*) as total FROM sanpham WHERE soluongton = 0"),
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
      `SELECT g.ID, g.masanpham, g.soluong, g.Size, g.mausac,
              s.tensanpham, s.giaban, s.soluongton
       FROM giohang_online g JOIN sanpham s ON g.masanpham = s.masanpham
       WHERE g.customerid = $1 ORDER BY g.ID`,
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
    const { masanpham, soluong = 1, Size, mausac } = req.body;
    if (!masanpham) return res.status(400).json({ error: "Thiếu masanpham" });
    // Kiểm tra tồn kho
    const sp = await pool.query(
      "SELECT soluongton FROM sanpham WHERE masanpham=$1 AND tinhtrang!='Ẩn'",
      [masanpham],
    );
    if (!sp.rows.length)
      return res.status(404).json({ error: "Sản phẩm không tồn tại" });
    if (sp.rows[0].soLuongTon < soluong)
      return res.status(400).json({ error: "Không đủ hàng" });

    // Nếu đã có → cộng số lượng
    const existing = await pool.query(
      "SELECT ID, soluong FROM giohang_online WHERE customerid=$1 AND masanpham=$2 AND Size=$3 AND mausac=$4",
      [req.user.id, masanpham, Size || "", mausac || ""],
    );
    if (existing.rows.length) {
      await pool.query(
        "UPDATE giohang_online SET soluong=soluong+$1 WHERE ID=$2",
        [soluong, existing.rows[0].id],
      );
    } else {
      await pool.query(
        "INSERT INTO giohang_online (customerid, masanpham, soluong, Size, mausac) VALUES ($1,$2,$3,$4,$5)",
        [req.user.id, masanpham, soluong, Size || "", mausac || ""],
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
    const { soluong } = req.body;
    if (soluong < 1)
      return res.status(400).json({ error: "Số lượng không hợp lệ" });
    // Chỉ cho phép sửa giỏ của chính mình
    await pool.query(
      "UPDATE giohang_online SET soluong=$1 WHERE ID=$2 AND customerid=$3",
      [soluong, req.params.id, req.user.id],
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
      "DELETE FROM giohang_online WHERE ID=$1 AND customerid=$2",
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
// Khách đăng nhập: dùng customerid từ token
// Khách vãn lai: truyền thông tin giao hàng, KHÔNG lưu tài khoản
app.post("/api/donhang", async (req, res) => {
  try {
    const {
      items,
      hotennguoinhan,
      sodienthoainhan,
      diachigiao,
      ghichu,
      phuongthuctt,
    } = req.body;
    if (!items || !items.length)
      return res.status(400).json({ error: "Giỏ hàng trống" });
    if (!hotennguoinhan || !sodienthoainhan || !diachigiao)
      return res.status(400).json({ error: "Thiếu thông tin giao hàng" });

    // Xác định customerid: nếu là khách đăng nhập thì dùng ID từ token
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
          "SELECT giaban, soluongton FROM sanpham WHERE masanpham=$1 AND tinhtrang!='Ẩn'",
          [item.masanpham],
        );
        if (!sp.rows.length)
          throw new Error(`Sản phẩm ${item.masanpham} không tồn tại`);
        if (sp.rows[0].soLuongTon < item.soluong)
          throw new Error(`${item.masanpham} không đủ hàng`);
        tongTien += parseFloat(sp.rows[0].giaban) * item.soluong;
      }

      // Tạo mã hóa đơn
      const maHD = "HD" + Date.now();
      const hdResult = await client.query(
        `INSERT INTO hoadonbanhang
           (mahoadon, customerid, hotennguoinhan, sodienthoainhan, diachigiao, ghichu, tongtien, trangthai, phuongthuctt, ngayban)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'Chờ xử lý',$8,NOW()) RETURNING *`,
        [
          maHD,
          customerID,
          hotennguoinhan,
          sodienthoainhan,
          diachigiao,
          ghichu || "",
          tongTien,
          phuongthuctt || "Tiền mặt",
        ],
      );

      // Thêm chi tiết + trừ kho
      for (const item of items) {
        const sp = await client.query(
          "SELECT giaban FROM sanpham WHERE masanpham=$1",
          [item.masanpham],
        );
        await client.query(
          "INSERT INTO chi_tiet_hoa_don (mahoadon, masanpham, soluong, dongia, Size, mausac) VALUES ($1,$2,$3,$4,$5,$6)",
          [
            maHD,
            item.masanpham,
            item.soluong,
            sp.rows[0].giaban,
            item.Size || "",
            item.mausac || "",
          ],
        );
        await client.query(
          "UPDATE sanpham SET soluongton=soluongton-$1 WHERE masanpham=$2",
          [item.soluong, item.masanpham],
        );
      }

      // Xóa giỏ hàng nếu là khách đăng nhập
      if (customerID) {
        await client.query("DELETE FROM giohang_online WHERE customerid=$1", [
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
      `SELECT h.*, array_agg(json_build_object('ten', s.tensanpham, 'sl', ct.soluong, 'gia', ct.dongia)) as items
       FROM hoadonbanhang h
       LEFT JOIN chi_tiet_hoa_don ct ON h.mahoadon = ct.mahoadon
       LEFT JOIN sanpham s ON ct.masanpham = s.masanpham
       WHERE h.customerid = $1
       GROUP BY h.mahoadon ORDER BY h.ngayban DESC LIMIT 50`,
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
      let q = "SELECT * FROM sanpham WHERE 1=1";
      const p = [];
      if (search) {
        p.push(`%${search}%`);
        q += ` AND (tensanpham ILIKE $${p.length} OR masanpham ILIKE $${p.length} OR SKU ILIKE $${p.length})`;
      }
      if (danhmuc) {
        p.push(danhmuc);
        q += ` AND danhmuc = $${p.length}`;
      }
      if (thuonghieu) {
        p.push(thuonghieu);
        q += ` AND thuonghieu = $${p.length}`;
      }
      if (tinhtrang) {
        p.push(tinhtrang);
        q += ` AND tinhtrang = $${p.length}`;
      }
      q += ` ORDER BY tensanpham LIMIT $${p.length + 1} OFFSET $${p.length + 2}`;
      p.push(parseInt(limit), (parseInt(page) - 1) * parseInt(limit));
      const [rows, cnt] = await Promise.all([
        pool.query(q, p),
        pool.query("SELECT COUNT(*) FROM sanpham"),
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
        masanpham, tensanpham, thuonghieu, danhmuc,
        gianhap, giaban, Size, mausac, motasanpham,
        chinhsachdoitra, chinhsachbaohanh, tinhtrang,
        soluongton, SKU, hinhanh,
      } = req.body;
      if (!masanpham || !tensanpham)
        return res.status(400).json({ error: "Thiếu masanpham hoặc tensanpham" });
      const r = await pool.query(
        `INSERT INTO sanpham (masanpham,tensanpham,thuonghieu,danhmuc,gianhap,giaban,Size,mausac,motasanpham,chinhsachdoitra,chinhsachbaohanh,tinhtrang,soluongton,SKU,hinhanh)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
        [
          masanpham, tensanpham, thuonghieu || "", danhmuc || "",
          gianhap || null, giaban || null,
          Size || "", mausac || "", motasanpham || "",
          chinhsachdoitra || "", chinhsachbaohanh || "",
          tinhtrang || "Đang bán", soluongton || 0,
          SKU || "", hinhanh || "",
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
        `UPDATE sanpham SET ${set} WHERE masanpham = $${vals.length} RETURNING *`,
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
        "DELETE FROM sanpham WHERE masanpham = $1 RETURNING masanpham",
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
        "SELECT tinhtrang FROM sanpham WHERE masanpham=$1",
        [req.params.ma],
      );
      if (!r.rows.length)
        return res.status(404).json({ error: "Không tìm thấy" });
      const next = r.rows[0].tinhtrang === "Ẩn" ? "Đang bán" : "Ẩn";
      const upd = await pool.query(
        "UPDATE sanpham SET tinhtrang=$1 WHERE masanpham=$2 RETURNING *",
        [next, req.params.ma],
      );
      res.json({ success: true, data: upd.rows[0] });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  },
);

// ── SUPABASE STORAGE CONFIG ───────────────────────────────────
const SUPABASE_URL  = process.env.SUPABASE_URL  || "https://mufxhkvktyiykcqnlpzx.supabase.co";
const SUPABASE_ANON = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON || "sb_publishable_rv6_3zvCyO0PsfwyNYZzNQ_NUp9m-qX";

async function uploadToSupabase(buffer, filename, mimetype) {
  // Thử upload Supabase nếu key hợp lệ (không phải sb_publishable)
  if (SUPABASE_URL && SUPABASE_ANON && !SUPABASE_ANON.startsWith("sb_publishable")) {
    try {
      const uploadUrl = `${SUPABASE_URL}/storage/v1/object/products/${filename}`;
      console.log(`[Upload Supabase] → ${uploadUrl}`);
      const r = await fetch(uploadUrl, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${SUPABASE_ANON}`,
          "Content-Type": mimetype,
          "x-upsert": "true",
        },
        body: buffer,
      });
      const txt = await r.text();
      if (r.ok) {
        const pub = `${SUPABASE_URL}/storage/v1/object/public/products/${filename}`;
        console.log(`[Upload Supabase] Thanh cong → ${pub}`);
        return pub;
      }
      console.warn(`[Upload Supabase] That bai (${r.status}): ${txt} — dung local`);
    } catch(e) {
      console.warn(`[Upload Supabase] Loi: ${e.message} — dung local`);
    }
  } else {
    console.log("[Upload] Supabase chua cau hinh key hop le — luu local");
  }

  // Fallback: luu file xuong disk local
  if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  const localPath = path.join(UPLOADS_DIR, filename);
  fs.writeFileSync(localPath, buffer);
  const localUrl = `/uploads/products/${filename}`;
  console.log(`[Upload Local] Da luu → ${localUrl}`);
  return localUrl;
}

// ── UPLOAD NHIỀU ẢNH SẢN PHẨM ────────────────────────────────
// POST /api/admin/sanpham/:ma/upload-images
// fields: images[] (files), mausac[] (string per file), la_anh_chinh (index of main image)
app.post(
  "/api/admin/sanpham/:ma/upload-images",
  requireRole("shop", "admin"),
  upload.array("images", 10),
  async (req, res) => {
    try {
      const ma = req.params.ma;
      const files = req.files || [];
      if (!files.length) return res.status(400).json({ error: "Không có file ảnh" });

      const mausacArr   = [].concat(req.body.mausac   || []);
      const mainIndex   = parseInt(req.body.la_anh_chinh ?? 0, 10);
      const datChinh    = req.body.dat_anh_chinh === "true"; // có update hinhanh không

      const saved = [];
      for (let i = 0; i < files.length; i++) {
        const f    = files[i];
        const ext  = f.originalname.split(".").pop().toLowerCase() || "jpg";
        const fname= `${ma.replace(/[^a-z0-9_-]/gi,"_")}_${Date.now()}_${i}.${ext}`;
        const url  = await uploadToSupabase(f.buffer, fname, f.mimetype);
        const mau  = mausacArr[i] || "";
        const isMain = (i === mainIndex);

        await pool.query(
          `INSERT INTO sanpham_images (masanpham, url, mausac, la_anh_chinh, thu_tu)
           VALUES ($1,$2,$3,$4,$5)`,
          [ma, url, mau, isMain, i]
        );
        // FIX Bug 2b: Luôn update hinhanh khi đây là ảnh chính (isMain),
        // không phụ thuộc vào flag dat_anh_chinh từ client
        if (isMain) {
          await pool.query("UPDATE sanpham SET hinhanh=$1 WHERE masanpham=$2", [url, ma]);
        }
        saved.push({ url, mausac: mau, la_anh_chinh: isMain });
      }
      res.json({ success: true, images: saved });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  },
);

// ── UPLOAD ẢNH ĐƠN LẺ (backward compat) ─────────────────────
app.post(
  "/api/admin/sanpham/:ma/upload-image",
  requireRole("shop", "admin"),
  upload.single("image"),
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "Không có file ảnh" });
      const ma  = req.params.ma;
      const ext = req.file.originalname.split(".").pop().toLowerCase() || "jpg";
      const fname = `${ma.replace(/[^a-z0-9_-]/gi,"_")}_${Date.now()}.${ext}`;
      const url = await uploadToSupabase(req.file.buffer, fname, req.file.mimetype);
      await pool.query("UPDATE sanpham SET hinhanh=$1 WHERE masanpham=$2", [url, ma]);
      await pool.query(
        `INSERT INTO sanpham_images (masanpham,url,mausac,la_anh_chinh,thu_tu)
         VALUES ($1,$2,'',true,0)
         ON CONFLICT DO NOTHING`,
        [ma, url]
      );
      res.json({ success: true, url });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  },
);

// ── LẤY DANH SÁCH ẢNH SẢN PHẨM ──────────────────────────────
app.get("/api/sanpham/:ma/images", async (req, res) => {
  try {
    const ma = req.params.ma;
    const r = await pool.query(
      "SELECT id,url,mausac,la_anh_chinh,thu_tu FROM sanpham_images WHERE masanpham=$1 ORDER BY thu_tu,id",
      [ma]
    );
    // FIX Bug 2b: Nếu sanpham_images trống, fallback sang cột hinhanh
    if (r.rows.length === 0) {
      const sp = await pool.query(
        "SELECT hinhanh FROM sanpham WHERE masanpham=$1",
        [ma]
      );
      if (sp.rows.length && sp.rows[0].hinhanh) {
        const url = sp.rows[0].hinhanh;
        // Tự động insert vào sanpham_images để lần sau không cần fallback
        await pool.query(
          `INSERT INTO sanpham_images (masanpham, url, mausac, la_anh_chinh, thu_tu)
           VALUES ($1, $2, '', true, 0) ON CONFLICT DO NOTHING`,
          [ma, url]
        ).catch(() => {}); // ignore nếu lỗi constraint
        return res.json({ images: [{ id: 0, url, mausac: '', la_anh_chinh: true, thu_tu: 0 }] });
      }
    }
    res.json({ images: r.rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── LẤY ẢNH CHÍNH NHIỀU SẢN PHẨM (cho danh sách) ─────────────
// POST /api/sanpham-images/batch  body: { ids: ["SP001","SP002",...] }
app.post("/api/sanpham-images/batch", async (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids || !ids.length) return res.json({ images: {} });
    const r = await pool.query(
      `SELECT DISTINCT ON (masanpham) masanpham, url, mausac
       FROM sanpham_images
       WHERE masanpham = ANY($1) AND la_anh_chinh = true
       ORDER BY masanpham, thu_tu, id`,
      [ids]
    );
    // fallback: nếu chưa đánh la_anh_chinh thì lấy ảnh đầu tiên
    const mainMap = {};
    r.rows.forEach(row => { mainMap[row.masanpham] = row.url; });

    // Với SP chưa có ảnh la_anh_chinh, lấy ảnh đầu tiên từ sanpham_images
    const missing = ids.filter(id => !mainMap[id]);
    if (missing.length) {
      const r2 = await pool.query(
        `SELECT DISTINCT ON (masanpham) masanpham, url
         FROM sanpham_images WHERE masanpham = ANY($1) ORDER BY masanpham, thu_tu, id`,
        [missing]
      );
      r2.rows.forEach(row => { mainMap[row.masanpham] = row.url; });
    }

    // FIX Bug 2a: Với SP vẫn chưa có trong sanpham_images, fallback sang cột hinhanh
    const stillMissing = ids.filter(id => !mainMap[id]);
    if (stillMissing.length) {
      const r3 = await pool.query(
        `SELECT masanpham, hinhanh FROM sanpham
         WHERE masanpham = ANY($1)
           AND hinhanh IS NOT NULL AND hinhanh != ''`,
        [stillMissing]
      );
      r3.rows.forEach(row => { mainMap[row.masanpham] = row.hinhanh; });
    }

    res.json({ images: mainMap });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── XÓA ẢNH SẢN PHẨM ─────────────────────────────────────────
app.delete("/api/admin/sanpham/:ma/images/:id", requireRole("shop","admin"), async (req, res) => {
  try {
    await pool.query("DELETE FROM sanpham_images WHERE id=$1 AND masanpham=$2", [req.params.id, req.params.ma]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── IMPORT EXCEL (admin/shop) — có trích xuất ảnh nhúng ──────
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

      // ── Đọc header ──────────────────────────────────────────
      const headers = [];
      worksheet.getRow(1).eachCell((cell) => headers.push(String(cell.value || "")));

      // ── Đọc dữ liệu từng dòng ───────────────────────────────
      const rows = [];
      worksheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        const obj = {};
        row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
          const key = headers[colNumber - 1];
          if (key) obj[key] = cell.value ?? "";
        });
        obj._rowNumber = rowNumber;
        rows.push(obj);
      });

      // ── Trích xuất ảnh nhúng trong worksheet ─────────────────
      // ExcelJS lưu images trong worksheet.getImages()
      // Mỗi image có range chứa row → map rowNumber → imageBuffer
      const rowImageMap = {}; // rowNumber → { buffer, ext }
      try {
        const images = worksheet.getImages();
        for (const img of images) {
          const imageData = workbook.getImage(img.imageId);
          const rowNum = (img.range?.tl?.nativeRow ?? img.range?.tl?.row ?? -1) + 1; // 0-indexed → 1-indexed
          if (rowNum > 1 && imageData?.buffer) {
            const ext = (imageData.extension || "jpeg").replace("jpeg", "jpg");
            rowImageMap[rowNum] = { buffer: imageData.buffer, ext };
          }
        }
      } catch (_) { /* worksheet không có ảnh nhúng — bỏ qua */ }

      // ── Validate & Insert ────────────────────────────────────
      const REQUIRED = ["masanpham", "tensanpham"];
      const results = { success: [], errors: [], warnings: [] };
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        for (const [idx, row] of rows.entries()) {
          const lineNum = idx + 2;
          const missing = REQUIRED.filter((f) => !row[f]);
          if (missing.length) {
            results.errors.push({ line: lineNum, reason: `Thiếu: ${missing.join(", ")}` });
            continue;
          }
          const existing = await client.query(
            "SELECT masanpham FROM sanpham WHERE masanpham = $1",
            [row.masanpham],
          );
          if (existing.rows.length) {
            results.warnings.push({ line: lineNum, reason: `${row.masanpham} đã tồn tại` });
            continue;
          }

          // Lưu ảnh nhúng lên Supabase Storage
          let hinhAnh = row.hinhanh || "";
          const imgData = rowImageMap[row._rowNumber];
          if (imgData) {
            try {
              const filename = `${String(row.masanpham).replace(/[^a-z0-9_-]/gi, "_")}_${Date.now()}.${imgData.ext}`;
              const uploadRes = await fetch(
                `${SUPABASE_URL}/storage/v1/object/products/${filename}`,
                {
                  method: "POST",
                  headers: {
                    "Authorization": `Bearer ${SUPABASE_ANON}`,
                    "Content-Type": `image/${imgData.ext}`,
                    "x-upsert": "true",
                  },
                  body: imgData.buffer,
                }
              );
              if (uploadRes.ok) {
                hinhAnh = `${SUPABASE_URL}/storage/v1/object/public/products/${filename}`;
              }
            } catch (_) { /* lỗi lưu ảnh — vẫn import sản phẩm, bỏ ảnh */ }
          }

          await client.query(
            `INSERT INTO sanpham
               (masanpham,tensanpham,thuonghieu,danhmuc,gianhap,giaban,
                Size,mausac,motasanpham,chinhsachdoitra,chinhsachbaohanh,
                tinhtrang,soluongton,SKU,hinhanh)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
            [
              row.masanpham, row.tensanpham,
              row.thuonghieu || "", row.danhmuc || "",
              parseFloat(row.gianhap) || null,
              parseFloat(row.giaban)  || null,
              row.Size || "", row.mausac || "",
              row.motasanpham || "", row.chinhsachdoitra || "",
              row.chinhsachbaohanh || "",
              row.tinhtrang || "Đang bán",
              parseInt(row.soluongton) || 0,
              row.SKU || "", hinhAnh,
            ],
          );
          results.success.push({ line: lineNum, masanpham: row.masanpham, hasImage: !!imgData });
        }
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }

      const withImage = results.success.filter(r => r.hasImage).length;
      res.json({
        imported: results.success.length,
        skipped:  results.warnings.length,
        failed:   results.errors.length,
        withImage,
        details:  results,
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
      let q = `SELECT h.*, k.hoten as TenKhachHang, k.sodienthoai FROM hoadonbanhang h LEFT JOIN khachhang k ON h.customerid = k.customerid WHERE 1=1`;
      const p = [];
      if (status) {
        p.push(status);
        q += ` AND h.trangthai = $${p.length}`;
      }
      if (search) {
        p.push(`%${search}%`);
        q += ` AND (h.mahoadon ILIKE $${p.length} OR k.hoten ILIKE $${p.length})`;
      }
      q += ` ORDER BY h.ngayban DESC LIMIT $${p.length + 1} OFFSET $${p.length + 2}`;
      p.push(parseInt(limit), (parseInt(page) - 1) * parseInt(limit));
      const [rows, cnt] = await Promise.all([
        pool.query(q, p),
        pool.query("SELECT COUNT(*) FROM hoadonbanhang"),
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
      const { trangthai } = req.body;
      const valid = [
        "Chờ xử lý",
        "Đã xác nhận",
        "Đang giao",
        "Hoàn thành",
        "Đã hủy",
        "Hoàn trả",
      ];
      if (!valid.includes(trangthai))
        return res.status(400).json({ error: "Trạng thái không hợp lệ" });
      const r = await pool.query(
        "UPDATE hoadonbanhang SET trangthai=$1 WHERE mahoadon=$2 RETURNING *",
        [trangthai, req.params.ma],
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
    await pool.query("DELETE FROM chi_tiet_hoa_don WHERE mahoadon=$1", [
      req.params.ma,
    ]);
    await pool.query("DELETE FROM hoadonbanhang WHERE mahoadon=$1", [
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
        "SELECT customerid,hoten,email,sodienthoai,diachi,ngaytao FROM khachhang WHERE 1=1";
      const p = [];
      if (search) {
        p.push(`%${search}%`);
        q += ` AND (hoten ILIKE $${p.length} OR email ILIKE $${p.length} OR sodienthoai ILIKE $${p.length})`;
      }
      q += ` ORDER BY ngaytao DESC LIMIT $${p.length + 1} OFFSET $${p.length + 2}`;
      p.push(parseInt(limit), (parseInt(page) - 1) * parseInt(limit));
      const [rows, cnt] = await Promise.all([
        pool.query(q, p),
        pool.query("SELECT COUNT(*) FROM khachhang"),
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
      await pool.query("DELETE FROM khachhang WHERE customerid=$1", [
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
    const { Ten, Ma, Mota, trangthai } = req.body;
    if (!Ten) return res.status(400).json({ error: "Tên không được trống" });
    const r = await pool.query(
      "INSERT INTO danhmuc (Ten,Ma,Mota,trangthai) VALUES ($1,$2,$3,$4) RETURNING *",
      [Ten, Ma || "", Mota || "", trangthai || "Hoat dong"],
    );
    res.json({ success: true, data: r.rows[0] });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.put("/api/admin/danhmuc/:id", requireRole("admin"), async (req, res) => {
  try {
    const { Ten, Ma, Mota, trangthai } = req.body;
    const r = await pool.query(
      "UPDATE danhmuc SET Ten=$1,Ma=$2,Mota=$3,trangthai=$4 WHERE ID=$5 RETURNING *",
      [Ten, Ma, Mota, trangthai, req.params.id],
    );
    res.json({ success: true, data: r.rows[0] });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete("/api/admin/danhmuc/:id", requireRole("admin"), async (req, res) => {
  try {
    await pool.query("DELETE FROM danhmuc WHERE ID=$1", [req.params.id]);
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
        `SELECT pt.*, k.hoten, nq.hoten as TenNguoiThu
       FROM phieuthu pt
       LEFT JOIN khachhang k ON pt.customerid=k.customerid
       LEFT JOIN nguoiquanly nq ON pt.idnguoiquanly=nq.idnguoiquanly
       ORDER BY pt.ngaythu DESC LIMIT 100`,
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
      const { maphieuthu, customerid, sotieuthu, ghichu, paymentmethodid } =
        req.body;
      if (!maphieuthu || !sotieuthu)
        return res.status(400).json({ error: "Thiếu mã phiếu hoặc số tiền" });
      const idnguoiquanly = req.user.id; // Lấy từ JWT, không nhận từ body
      const r = await pool.query(
        `INSERT INTO phieuthu (maphieuthu,idnguoiquanly,customerid,sotieuthu,ghichu,trangthai,paymentmethodid,ngaythu)
       VALUES ($1,$2,$3,$4,$5,'Đã thu',$6,NOW()) RETURNING *`,
        [
          maphieuthu,
          idnguoiquanly,
          customerid || null,
          sotieuthu,
          ghichu || "",
          paymentmethodid || null,
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
        `SELECT pc.*, n.tennhacungcap, nq.hoten as TenNguoiChi
       FROM phieuchi pc
       LEFT JOIN nhacungcap n ON pc.supplierid=n.supplierid
       LEFT JOIN nguoiquanly nq ON pc.idnguoiquanly=nq.idnguoiquanly
       ORDER BY pc.ngaychi DESC LIMIT 100`,
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
      const { maphieuchi, supplierid, sotienchi, ghichu, paymentmethodid } =
        req.body;
      if (!maphieuchi || !sotienchi)
        return res.status(400).json({ error: "Thiếu mã phiếu hoặc số tiền" });
      const idnguoiquanly = req.user.id; // Lấy từ JWT
      const r = await pool.query(
        `INSERT INTO phieuchi (maphieuchi,idnguoiquanly,supplierid,sotienchi,ghichu,trangthai,paymentmethodid,ngaychi)
       VALUES ($1,$2,$3,$4,$5,'Chờ duyệt',$6,NOW()) RETURNING *`,
        [
          maphieuchi,
          idnguoiquanly,
          supplierid || null,
          sotienchi,
          ghichu || "",
          paymentmethodid || null,
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
        "UPDATE phieuchi SET trangthai='Đã duyệt' WHERE maphieuchi=$1 RETURNING *",
        [req.params.ma],
      );
      res.json({ success: true, data: r.rows[0] });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  },
);

// ── KẾ TOÁN: HÓA ĐƠN VAT ────────────────────────────────────
app.get("/api/ketoan/hoadon-vat", requireRole("accountant","admin","shop"), async (req,res) => {
  try {
    const { month } = req.query;
    let q = "SELECT * FROM hoadon_vat ORDER BY ngaytao DESC LIMIT 200";
    const params = [];
    if (month) {
      q = "SELECT * FROM hoadon_vat WHERE TO_CHAR(ngaytao,'YYYY-MM')=$1 ORDER BY ngaytao DESC";
      params.push(month);
    }
    const r = await pool.query(q, params);
    res.json({ ok: true, data: r.rows });
  } catch(e) { res.status(500).json({ ok:false, error: e.message }); }
});

app.post("/api/ketoan/hoadon-vat", requireRole("accountant","admin"), async (req,res) => {
  try {
    const { tenkhach, mst, diachi, giaTruocVAT, vatRate=10, ghichu, mahoadon } = req.body;
    if (!tenkhach || !giaTruocVAT) return res.status(400).json({ ok:false, error:"Thiếu tên khách hoặc giá trị" });
    const tienVAT = Math.round(giaTruocVAT * vatRate / 100);
    const tongTT  = giaTruocVAT + tienVAT;
    const soHD    = "VAT" + Date.now();
    const r = await pool.query(
      `INSERT INTO hoadon_vat (sohd, tenkhach, mst, diachi, gia_truoc_vat, vat_rate, tien_vat, tong_tt, ghichu, mahoadon, ngaytao)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW()) RETURNING *`,
      [soHD, tenkhach, mst||"", diachi||"", giaTruocVAT, vatRate, tienVAT, tongTT, ghichu||"", mahoadon||null]
    );
    res.json({ ok:true, data: { ...r.rows[0], soHD, tongTT } });
  } catch(e) { res.status(400).json({ ok:false, error: e.message }); }
});

// ── KẾ TOÁN: CHI PHÍ ─────────────────────────────────────────
app.get("/api/ketoan/chiphi", requireRole("accountant","admin","shop"), async (req,res) => {
  try {
    const { month } = req.query;
    let q = "SELECT * FROM chiphi ORDER BY ngaytao DESC LIMIT 200";
    const params = [];
    if (month) { q = "SELECT * FROM chiphi WHERE TO_CHAR(ngaytao,'YYYY-MM')=$1 ORDER BY ngaytao DESC"; params.push(month); }
    const r = await pool.query(q, params);
    res.json({ ok:true, data: r.rows });
  } catch(e) { res.status(500).json({ ok:false, error: e.message }); }
});

app.post("/api/ketoan/chiphi", requireRole("accountant","admin"), async (req,res) => {
  try {
    const { loaichiphi, mota, sotien, ngaytao, trangthai } = req.body;
    if (!loaichiphi || !sotien) return res.status(400).json({ ok:false, error:"Thiếu loại chi phí hoặc số tiền" });
    const r = await pool.query(
      `INSERT INTO chiphi (loaichiphi, mota, sotien, trangthai, ngaytao) VALUES ($1,$2,$3,$4,COALESCE($5::date, NOW())) RETURNING *`,
      [loaichiphi, mota||"", sotien, trangthai||"Chờ duyệt", ngaytao||null]
    );
    res.json({ ok:true, data: r.rows[0] });
  } catch(e) { res.status(400).json({ ok:false, error: e.message }); }
});

app.patch("/api/ketoan/chiphi/:id/approve", requireRole("accountant","admin"), async (req,res) => {
  try {
    const r = await pool.query("UPDATE chiphi SET trangthai='Đã duyệt' WHERE id=$1 RETURNING *", [req.params.id]);
    res.json({ ok:true, data: r.rows[0] });
  } catch(e) { res.status(400).json({ ok:false, error: e.message }); }
});

// ── KẾ TOÁN: DÒNG TIỀN (CASHFLOW) ───────────────────────────
app.get("/api/ketoan/cashflow", requireRole("accountant","admin","shop"), async (req,res) => {
  try {
    const { month } = req.query;
    const m = month || new Date().toISOString().slice(0,7);
    const [thu, chi] = await Promise.all([
      pool.query(`SELECT 'thu' as loai, mahoadon as ma, hotennguoinhan as mota, tongtien as sotien, ngayban as ngay FROM hoadonbanhang WHERE TO_CHAR(ngayban,'YYYY-MM')=$1 AND trangthai!='Đã huỷ' ORDER BY ngayban DESC LIMIT 100`, [m]),
      pool.query(`SELECT 'chi' as loai, maphieuchi as ma, noidung as mota, sotien, ngaydukien as ngay FROM phieuchi WHERE TO_CHAR(ngaydukien,'YYYY-MM')=$1 ORDER BY ngaydukien DESC LIMIT 100`, [m])
    ]);
    const rows = [...thu.rows, ...chi.rows].sort((a,b) => new Date(b.ngay) - new Date(a.ngay));
    const tongThu = thu.rows.reduce((s,r) => s+parseFloat(r.sotien||0), 0);
    const tongChi = chi.rows.reduce((s,r) => s+parseFloat(r.sotien||0), 0);
    res.json({ ok:true, data: rows, tongThu, tongChi, conLai: tongThu-tongChi });
  } catch(e) { res.status(500).json({ ok:false, error: e.message }); }
});

// ── KẾ TOÁN: EXPORT ──────────────────────────────────────────
app.get("/api/ketoan/export/donhang", requireRole("accountant","admin","shop"), async (req,res) => {
  try {
    const { month, status } = req.query;
    const m = month || new Date().toISOString().slice(0,7);
    const params = [m];
    let q = `SELECT mahoadon,hotennguoinhan,sodienthoainhan,diachigiao,tongtien,trangthai,phuongthuctt,ngayban FROM hoadonbanhang WHERE TO_CHAR(ngayban,'YYYY-MM')=$1`;
    if (status) { params.push(status); q += ` AND trangthai=$${params.length}`; }
    q += " ORDER BY ngayban DESC";
    const r = await pool.query(q, params);
    // CSV
    const headers = "Mã HĐ,Người Nhận,SĐT,Địa Chỉ,Tổng Tiền,Trạng Thái,Thanh Toán,Ngày\n";
    const rows = r.rows.map(row =>
      [row.mahoadon,row.hotennguoinhan,row.sodienthoainhan,`"${row.diachigiao||''}"`,row.tongtien,row.trangthai,row.phuongthuctt,new Date(row.ngayban).toLocaleDateString('vi-VN')].join(',')
    ).join('\n');
    res.setHeader('Content-Type','text/csv; charset=utf-8');
    res.setHeader('Content-Disposition',`attachment; filename=DonHang_${m}.csv`);
    res.send('\uFEFF' + headers + rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/ketoan/export/doanhthu", requireRole("accountant","admin","shop"), async (req,res) => {
  try {
    const { month } = req.query;
    const m = month || new Date().toISOString().slice(0,7);
    const r = await pool.query(`SELECT mahoadon,hotennguoinhan,tongtien,trangthai,ngayban FROM hoadonbanhang WHERE TO_CHAR(ngayban,'YYYY-MM')=$1 ORDER BY ngayban DESC`, [m]);
    const headers = "Mã HĐ,Khách Hàng,Doanh Thu,Trạng Thái,Ngày\n";
    const rows = r.rows.map(row => [row.mahoadon,row.hotennguoinhan,row.tongtien,row.trangthai,new Date(row.ngayban).toLocaleDateString('vi-VN')].join(',')).join('\n');
    res.setHeader('Content-Type','text/csv; charset=utf-8');
    res.setHeader('Content-Disposition',`attachment; filename=DoanhThu_${m}.csv`);
    res.send('\uFEFF' + headers + rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/ketoan/export/chiphi", requireRole("accountant","admin","shop"), async (req,res) => {
  try {
    const { month } = req.query;
    const m = month || new Date().toISOString().slice(0,7);
    const r = await pool.query(`SELECT * FROM chiphi WHERE TO_CHAR(ngaytao,'YYYY-MM')=$1 ORDER BY ngaytao DESC`, [m]);
    const headers = "Loại Chi Phí,Mô Tả,Số Tiền,Trạng Thái,Ngày\n";
    const rows = r.rows.map(row => [row.loaichiphi,`"${row.mota||''}"`,row.sotien,row.trangthai,new Date(row.ngaytao).toLocaleDateString('vi-VN')].join(',')).join('\n');
    res.setHeader('Content-Type','text/csv; charset=utf-8');
    res.setHeader('Content-Disposition',`attachment; filename=ChiPhi_${m}.csv`);
    res.send('\uFEFF' + headers + rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/ketoan/export/cashflow", requireRole("accountant","admin","shop"), async (req,res) => {
  try {
    const { month } = req.query;
    const m = month || new Date().toISOString().slice(0,7);
    const r = await pool.query(`SELECT mahoadon as ma,'Thu' as loai,hotennguoinhan as mota,tongtien as sotien,ngayban as ngay FROM hoadonbanhang WHERE TO_CHAR(ngayban,'YYYY-MM')=$1 ORDER BY ngayban DESC`, [m]);
    const headers = "Mã,Loại,Mô Tả,Số Tiền,Ngày\n";
    const rows = r.rows.map(row => [row.ma,row.loai,`"${row.mota||''}"`,row.sotien,new Date(row.ngay).toLocaleDateString('vi-VN')].join(',')).join('\n');
    res.setHeader('Content-Type','text/csv; charset=utf-8');
    res.setHeader('Content-Disposition',`attachment; filename=CashFlow_${m}.csv`);
    res.send('\uFEFF' + headers + rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/ketoan/export/misa", requireRole("accountant","admin","shop"), async (req,res) => {
  try {
    const { month } = req.query;
    const m = month || new Date().toISOString().slice(0,7);
    const r = await pool.query(`SELECT mahoadon,hotennguoinhan,tongtien,trangthai,ngayban FROM hoadonbanhang WHERE TO_CHAR(ngayban,'YYYY-MM')=$1 ORDER BY ngayban DESC`, [m]);
    const headers = "Ngày Chứng Từ,Số Chứng Từ,Diễn Giải,Số Tiền,Tài Khoản\n";
    const rows = r.rows.map(row => [new Date(row.ngayban).toLocaleDateString('vi-VN'),row.mahoadon,`"Thu tiền ${row.hotennguoinhan||''}"`,row.tongtien,'131'].join(',')).join('\n');
    res.setHeader('Content-Type','text/csv; charset=utf-8');
    res.setHeader('Content-Disposition',`attachment; filename=MISA_${m}.csv`);
    res.send('\uFEFF' + headers + rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── THỐNG KÊ MỞ RỘNG (staff only) ───────────────────────────
app.get(
  "/api/admin/thongke",
  requireRole("shop", "admin", "accountant"),
  async (req, res) => {
    try {
      const [sp, kh, hd, het, tk] = await Promise.all([
        pool.query("SELECT COUNT(*) FROM sanpham"),
        pool.query("SELECT COUNT(*) FROM khachhang"),
        pool.query(
          "SELECT COUNT(*) as total, COALESCE(SUM(tongtien),0) as doanhthu FROM hoadonbanhang",
        ),
        pool.query("SELECT COUNT(*) FROM sanpham WHERE soluongton = 0"),
        pool.query(
          "SELECT trangthai, COUNT(*) as cnt FROM hoadonbanhang GROUP BY trangthai",
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


// ═══════════════════════════════════════════════════════════
// ĐÁNH GIÁ
// ═══════════════════════════════════════════════════════════
app.get("/api/admin/danhgia", requireRole("shop","admin"), async (req,res) => {
  try {
    const r = await pool.query(
      `SELECT g.ID, g.masanpham, g.sosao, g.noidung, g.trangthai, g.ngaydang,
              k.hoten as TenKhach, s.tensanpham
       FROM danh_gia g
       LEFT JOIN khachhang k ON k.customerid = g.customerid
       LEFT JOIN sanpham s ON s.masanpham = g.masanpham
       ORDER BY g.ngaydang DESC LIMIT 100`
    );
    res.json(r.rows);
  } catch(e) { res.status(500).json({error:e.message}); }
});

app.patch("/api/admin/danhgia/:id/duyet", requireRole("shop","admin"), async (req,res) => {
  try {
    await pool.query("UPDATE danh_gia SET trangthai='Đã duyệt' WHERE ID=$1", [req.params.id]);
    res.json({success:true});
  } catch(e) { res.status(500).json({error:e.message}); }
});

app.patch("/api/admin/danhgia/:id/tuchoi", requireRole("shop","admin"), async (req,res) => {
  try {
    await pool.query("UPDATE danh_gia SET trangthai='Từ chối' WHERE ID=$1", [req.params.id]);
    res.json({success:true});
  } catch(e) { res.status(500).json({error:e.message}); }
});

// ═══════════════════════════════════════════════════════════
// KHO HÀNG — Phiếu nhập
// ═══════════════════════════════════════════════════════════
app.get("/api/admin/phieunhap", requireRole("shop","admin"), async (req,res) => {
  try {
    const r = await pool.query(
      `SELECT p.maphieunhap, p.ngaynhap, p.tongtien, p.ghichu,
              n.tennhacungcap
       FROM phieunhap p
       LEFT JOIN nhacungcap n ON n.supplierid = p.supplierid
       ORDER BY p.ngaynhap DESC LIMIT 50`
    );
    res.json(r.rows);
  } catch(e) { res.status(500).json({error:e.message}); }
});

// ═══════════════════════════════════════════════════════════
// BÁO CÁO — Doanh thu theo tháng
// ═══════════════════════════════════════════════════════════
app.get("/api/admin/baocao/doanhthu", requireRole("shop","admin","accountant"), async (req,res) => {
  try {
    const [monthly, topSP, topKH, trangThai] = await Promise.all([
      pool.query(`
        SELECT TO_CHAR(ngayban,'MM/YYYY') as thang,
               COUNT(*) as sodon,
               COALESCE(SUM(tongtien),0) as doanhthu
        FROM hoadonbanhang
        WHERE ngayban >= NOW() - INTERVAL '6 months'
        GROUP BY TO_CHAR(ngayban,'MM/YYYY')
        ORDER BY MIN(ngayban)`),
      pool.query(`
        SELECT s.tensanpham, s.thuonghieu,
               COUNT(c.masanpham) as soban,
               COALESCE(SUM(c.soluong * c.dongia),0) as doanhthu
        FROM chi_tiet_hoa_don c
        JOIN sanpham s ON s.masanpham = c.masanpham
        GROUP BY s.masanpham, s.tensanpham, s.thuonghieu
        ORDER BY doanhthu DESC LIMIT 5`),
      pool.query(`
        SELECT k.hoten, k.email,
               COUNT(h.mahoadon) as sodon,
               COALESCE(SUM(h.tongtien),0) as tongtien
        FROM hoadonbanhang h
        JOIN khachhang k ON k.customerid = h.customerid
        GROUP BY k.customerid, k.hoten, k.email
        ORDER BY tongtien DESC LIMIT 5`),
      pool.query(`
        SELECT trangthai, COUNT(*) as cnt, COALESCE(SUM(tongtien),0) as tong
        FROM hoadonbanhang GROUP BY trangthai`)
    ]);
    res.json({
      monthly: monthly.rows,
      topSanPham: topSP.rows,
      topKhachHang: topKH.rows,
      theoTrangThai: trangThai.rows
    });
  } catch(e) { res.status(500).json({error:e.message}); }
});

// ═══════════════════════════════════════════════════════════
// KẾ TOÁN — Phiếu thu / chi tổng hợp
// ═══════════════════════════════════════════════════════════
app.get("/api/admin/ketoan", requireRole("shop","admin","accountant"), async (req,res) => {
  try {
    const [thu, chi, hd] = await Promise.all([
      pool.query(`SELECT COALESCE(SUM(sotieuthu),0) as tong, COUNT(*) as cnt FROM phieuthu
                  WHERE ngaythu >= DATE_TRUNC('month', NOW())`),
      pool.query(`SELECT COALESCE(SUM(sotienchi),0) as tong, COUNT(*) as cnt FROM phieuchi
                  WHERE ngaychi >= DATE_TRUNC('month', NOW())`),
      pool.query(`SELECT COALESCE(SUM(tongtien),0) as doanhthu, COUNT(*) as sodon
                  FROM hoadonbanhang
                  WHERE ngayban >= DATE_TRUNC('month', NOW())`)
    ]);
    res.json({
      tongThu:    parseFloat(thu.rows[0].tong),   soPhieuThu: parseInt(thu.rows[0].cnt),
      tongChi:    parseFloat(chi.rows[0].tong),   soPhieuChi: parseInt(chi.rows[0].cnt),
      doanhThu:   parseFloat(hd.rows[0].doanhthu), soHoaDon:  parseInt(hd.rows[0].sodon),
      loiNhuan:   parseFloat(hd.rows[0].doanhthu) - parseFloat(chi.rows[0].tong)
    });
  } catch(e) { res.status(500).json({error:e.message}); }
});

// ── QUẢN LÝ NGƯỜI DÙNG (super admin) ─────────────────────────
app.get("/api/admin/users", requireRole("admin"), async (req, res) => {
  try {
    const r = await pool.query(
      "SELECT idnguoiquanly,hoten,email,sodienthoai,vaitro,trangthai,ngaytao FROM nguoiquanly ORDER BY ngaytao DESC",
    );
    res.json(r.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/admin/users", requireRole("admin"), async (req, res) => {
  try {
    const { hoten, email, sodienthoai, matkhau, vaitro } = req.body;
    if (!hoten || !email || !matkhau)
      return res
        .status(400)
        .json({ error: "Thiếu họ tên, email hoặc mật khẩu" });
    const hashedPw = crypto
      .createHash("sha256")
      .update(matkhau + JWT_SECRET)
      .digest("hex");
    const r = await pool.query(
      `INSERT INTO nguoiquanly (hoten,email,sodienthoai,matkhau,vaitro,trangthai,ngaytao)
       VALUES ($1,$2,$3,$4,$5,'Hoạt động',NOW()) RETURNING idnguoiquanly,hoten,email,vaitro,trangthai`,
      [hoten, email, sodienthoai || "", hashedPw, vaitro || "shop"],
    );
    res.json({ success: true, data: r.rows[0] });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.put("/api/admin/users/:id", requireRole("admin"), async (req, res) => {
  try {
    const { hoten, email, sodienthoai, vaitro, trangthai } = req.body;
    const r = await pool.query(
      "UPDATE nguoiquanly SET hoten=$1,email=$2,sodienthoai=$3,vaitro=$4,trangthai=$5 WHERE idnguoiquanly=$6 RETURNING idnguoiquanly,hoten,email,vaitro,trangthai",
      [hoten, email, sodienthoai, vaitro, trangthai, req.params.id],
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
    await pool.query("DELETE FROM nguoiquanly WHERE idnguoiquanly=$1", [
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
      const { tennhacungcap, sodienthoai, email, diachi } = req.body;
      if (!tennhacungcap)
        return res
          .status(400)
          .json({ error: "Tên nhà cung cấp không được trống" });
      const r = await pool.query(
        "INSERT INTO nhacungcap (tennhacungcap,sodienthoai,email,diachi) VALUES ($1,$2,$3,$4) RETURNING *",
        [tennhacungcap, sodienthoai || "", email || "", diachi || ""],
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

// ── AUTO-CREATE sanpham_images table ─────────────────────────
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sanpham_images (
        id           SERIAL PRIMARY KEY,
        masanpham    VARCHAR(50)  NOT NULL,
        url          TEXT         NOT NULL,
        mausac       VARCHAR(100) DEFAULT '',
        la_anh_chinh BOOLEAN      DEFAULT false,
        thu_tu       INT          DEFAULT 0,
        created_at   TIMESTAMP    DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_sanpham_images_ma ON sanpham_images(masanpham);
    `);
    console.log('[DB] Bảng sanpham_images đã sẵn sàng');
  } catch(e) { console.error('[DB] Tạo bảng sanpham_images thất bại:', e.message); }
})();

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
      `SELECT tensanpham as ten, thuonghieu as hang, giaban as gia, soluongton as ton, madanhmuc as dm
       FROM sanpham WHERE tinhtrang != $1 ORDER BY tensanpham LIMIT 30`,
      ['Ẩn']
    );
    const products = prodRes.rows;
    const productList = products.map(p =>
      `- ${p.ten} (${p.hang}) | Giá: ${Number(p.gia).toLocaleString('vi-VN')}đ | Tồn: ${p.ton} | Danh mục: ${p.dm}`
    ).join('\n');

    // Gọi Groq API
    const GEMINI_KEY    = null;
    const ANTHROPIC_KEY = null;
    const GROQ_KEY_CHAT = process.env.GROQ_API_KEY;

    if (!GROQ_KEY_CHAT) {
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

    if (false) { // Gemini disabled, dùng Anthropic
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
      // ── Groq API (free) ────────────────────────────────────
      const GROQ_KEY = GROQ_KEY_CHAT;
      if (!GROQ_KEY) {
        reply = 'Xin chào! Hệ thống AI chưa được cấu hình. Vui lòng liên hệ shop qua hotline!';
      } else {
        const messages = history.map(m => ({
          role: m.sender === 'guest' ? 'user' : 'assistant',
          content: m.message
        }));
        if (messages.length === 0 || messages[0].role !== 'user') {
          messages.unshift({ role: 'user', content: message.trim() });
        }
        const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + GROQ_KEY
          },
          body: JSON.stringify({
            model: 'llama-3.1-8b-instant',
            max_tokens: 500,
            temperature: 0.7,
            messages: [{ role: 'system', content: systemPrompt }, ...messages]
          })
        });
        const groqData = await groqRes.json();
        if (groqData.error) {
          console.error('Groq error:', groqData.error);
          reply = 'Xin lỗi, tôi không thể trả lời lúc này. Vui lòng thử lại.';
        } else {
          reply = groqData?.choices?.[0]?.message?.content || 'Xin lỗi, tôi không thể trả lời lúc này.';
        }
      }
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
  } else {
    // API route không tồn tại → trả JSON thay vì HTML
    res.status(404).json({ error: "API route không tồn tại: " + req.path });
  }
});

// ── Global error handler — đảm bảo /api luôn trả JSON ───────
app.use((err, req, res, next) => {
  console.error("Server error:", err.message);
  if (req.path.startsWith("/api")) {
    return res.status(500).json({ error: err.message || "Lỗi server" });
  }
  next(err);
});

// ── Khởi động server ─────────────────────────────────────────
const PORT = process.env.PORT || 8080;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server SneakerVN tại http://0.0.0.0:${PORT}`);
  console.log(`   Nhớ set JWT_SECRET trong biến môi trường Replit!`);
});
process.env.NODE_ENV = 'production';