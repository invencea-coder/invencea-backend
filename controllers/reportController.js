// server/src/controllers/reportController.js
import { supabase } from "../config/supabaseClient.js";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";

/* =====================================================
   Helpers
===================================================== */
const buildReportsMap = (rows) => {
  const reportsMap = {};
  rows.forEach((row) => {
    const rid = row.borrow_request_id || row.request_id || row.id;
    if (!rid) return;

    if (!reportsMap[rid]) {
      reportsMap[rid] = {
        id: rid,
        requester_name: row.requester_name || row.student_name || "-",
        requester_id: row.student_id || null,
        status: String(row.status || "").toUpperCase(),
        requested_at: row.requested_at,
        approved_at: row.approved_at,
        issued_at: row.issued_at,
        returned_at: row.returned_at,
        items: [],
      };
    }

    reportsMap[rid].items.push({
      item_name: row.item_name || "Unknown",
      quantity: Number(row.issued_quantity ?? 0),
      barcode: row.barcode || null,
    });
  });

  return Object.values(reportsMap);
};

const toPHStart = (yyyyMmDd) => (yyyyMmDd ? new Date(`${yyyyMmDd}T00:00:00+08:00`).toISOString() : null);
const toPHEnd = (yyyyMmDd) => (yyyyMmDd ? new Date(`${yyyyMmDd}T23:59:59+08:00`).toISOString() : null);

/* Helper to get current admin id robustly */
const getCurrentAdminId = (req) => {
  // common shapes: req.user.id, req.user.user_id, req.user.sub
  return req?.user?.id ?? req?.user?.user_id ?? req?.user?.sub ?? null;
};

/* =====================================================
   GET REPORT DATA (JSON)
===================================================== */
export const getReports = async (req, res) => {
  try {
    const branchId = req.user?.branch_id || null;
    const currentAdminId = getCurrentAdminId(req);
    const { from, to } = req.query;

    let query = supabase
      .from("borrow_reports_view")
      .select("*")
      .order("requested_at", { ascending: false });

    if (branchId) query = query.eq("branch_id", branchId);
    if (from) query = query.gte("requested_at", toPHStart(from));
    if (to) query = query.lte("requested_at", toPHEnd(to));

    // Only include rows approved by this admin OR still pending
    if (currentAdminId) {
      query = query.or(`approved_by.eq.${currentAdminId},approved_by.is.null`);
    }

    const { data, error } = await query;
    if (error) throw error;

    const rows = Array.isArray(data) ? data : [];
    const reports = buildReportsMap(rows);

    return res.json(reports);
  } catch (err) {
    console.error("REPORT FETCH ERROR FULL:", err);
    return res.status(500).json({ message: "Failed to fetch reports" });
  }
};

/* =====================================================
   EXPORT EXCEL
===================================================== */
export const exportReportsExcel = async (req, res) => {
  try {
    const branchId = req.user?.branch_id || null;
    const currentAdminId = getCurrentAdminId(req);
    const { from, to } = req.query;

    let query = supabase.from("borrow_reports_view").select("*").order("requested_at", { ascending: false });
    if (branchId) query = query.eq("branch_id", branchId);
    if (from) query = query.gte("requested_at", toPHStart(from));
    if (to) query = query.lte("requested_at", toPHEnd(to));
    if (currentAdminId) query = query.or(`approved_by.eq.${currentAdminId},approved_by.is.null`);

    const { data, error } = await query;
    if (error) throw error;

    const rows = Array.isArray(data) ? data : [];
    const reports = buildReportsMap(rows);

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Borrow Reports");

    sheet.columns = [
      { header: "Borrower", key: "borrower", width: 30 },
      { header: "Borrower ID", key: "id", width: 18 },
      { header: "Items (item_name (qty))", key: "items", width: 60 },
      { header: "Status", key: "status", width: 12 },
      { header: "Requested At", key: "requested", width: 20 },
      { header: "Approved At", key: "approved", width: 20 },
      { header: "Issued At", key: "issued", width: 20 },
      { header: "Returned At", key: "returned", width: 20 },
    ];

    reports.forEach((r) => {
      sheet.addRow({
        borrower: r.requester_name,
        id: r.requester_id || "-",
        items: r.items.length
          ? r.items.map((i) => `${i.item_name} (${i.quantity})`).join(", ")
          : "-",
        status: r.status || "-",
        requested: r.requested_at || "-",
        approved: r.approved_at || "-",
        issued: r.issued_at || "-",
        returned: r.returned_at || "-",
      });
    });

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", "attachment; filename=borrow-reports.xlsx");

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("EXCEL EXPORT ERROR FULL:", err);
    return res.status(500).json({ message: "Failed to export Excel" });
  }
};

/* =====================================================
   EXPORT PDF
===================================================== */
export const exportReportsPDF = async (req, res) => {
  try {
    const branchId = req.user?.branch_id || null;
    const currentAdminId = getCurrentAdminId(req);
    const { from, to } = req.query;

    let query = supabase.from("borrow_reports_view").select("*").order("requested_at", { ascending: false });
    if (branchId) query = query.eq("branch_id", branchId);
    if (from) query = query.gte("requested_at", toPHStart(from));
    if (to) query = query.lte("requested_at", toPHEnd(to));
    if (currentAdminId) query = query.or(`approved_by.eq.${currentAdminId},approved_by.is.null`);

    const { data, error } = await query;
    if (error) throw error;

    const rows = Array.isArray(data) ? data : [];
    const reports = buildReportsMap(rows);

    const doc = new PDFDocument({ margin: 30, size: "A4" });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "attachment; filename=borrow-reports.pdf");

    doc.pipe(res);

    doc.fontSize(18).text("Borrow Reports", { align: "center" });
    doc.moveDown();

    reports.forEach((r) => {
      doc
        .fontSize(11)
        .text(`Borrower: ${r.requester_name}`)
        .text(`Items: ${r.items.length ? r.items.map(i => `${i.item_name} (${i.quantity})`).join(", ") : "-"}`)
        .text(`Status: ${r.status || "-"}`)
        .text(`Requested: ${r.requested_at || "-"}`)
        .text(`Approved: ${r.approved_at || "-"}`)
        .text(`Issued: ${r.issued_at || "-"}`)
        .text(`Returned: ${r.returned_at || "-"}`)
        .moveDown();
    });

    doc.end();
  } catch (err) {
    console.error("PDF EXPORT ERROR FULL:", err);
    return res.status(500).json({ message: "Failed to export PDF" });
  }
};

/* =====================================================
   DELETE REPORTS (branch-only, date-filtered)
===================================================== */
export const deleteReports = async (req, res) => {
  try {
    const branchId = req.user?.branch_id || null;
    const currentAdminId = getCurrentAdminId(req);
    if (!branchId) return res.status(400).json({ message: "branch_id required" });

    const { from, to } = req.query;
    if (!from && !to) return res.status(400).json({ message: "Please provide 'from' or 'to' to delete reports" });

    const fromISO = from ? toPHStart(from) : null;
    const toISO = to ? toPHEnd(to) : null;

    let query = supabase.from("borrow_requests").delete().eq("branch_id", branchId);
    if (fromISO) query = query.gte("requested_at", fromISO);
    if (toISO) query = query.lte("requested_at", toISO);

    if (currentAdminId) query = query.or(`approved_by.eq.${currentAdminId},approved_by.is.null`);

    const { data, error } = await query;
    if (error) throw error;

    return res.json({ message: `Deleted ${Array.isArray(data) ? data.length : 0} reports` });
  } catch (err) {
    console.error("DELETE REPORTS ERROR FULL:", err);
    return res.status(500).json({ message: "Failed to delete reports" });
  }
};
