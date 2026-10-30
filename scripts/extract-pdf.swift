import Foundation
import PDFKit
import Vision
import AppKit

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}
for path in CommandLine.arguments.dropFirst() {
    guard let doc = PDFDocument(url: URL(fileURLWithPath: path)), !doc.isEncrypted else { fail("Cannot read PDF or PDF is encrypted") }
    guard doc.pageCount > 0 && doc.pageCount <= 20 else { fail("PDF must contain 1 to 20 pages") }
    print("FILE: \(URL(fileURLWithPath: path).lastPathComponent)")
    for index in 0..<doc.pageCount {
        guard let page = doc.page(at: index) else { fail("Cannot read PDF page") }
        let native = page.string ?? ""
        if native.filter({ !$0.isWhitespace }).count >= 30 {
            print("PAGE \(index + 1) [TEXT]\n\(native)")
            continue
        }
        // OCR is selected per page so mixed text/scan PDFs retain every page.
        let bounds = page.bounds(for: .mediaBox)
        guard bounds.width > 0 && bounds.height > 0 else { fail("Invalid page dimensions") }
        let scale = min(3.0, 3000.0 / max(bounds.width, bounds.height))
        let image = page.thumbnail(of: NSSize(width: bounds.width * scale, height: bounds.height * scale), for: .mediaBox)
        var rect = CGRect(origin: .zero, size: image.size)
        guard let cgImage = image.cgImage(forProposedRect: &rect, context: nil, hints: nil) else { fail("Cannot render PDF page for OCR") }
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.recognitionLanguages = ["de-DE", "en-US"]
        request.usesLanguageCorrection = false
        do { try VNImageRequestHandler(cgImage: cgImage).perform([request]) }
        catch { fail("OCR failed on page \(index + 1): \(error.localizedDescription)") }
        let observations = request.results ?? []
        let candidates = observations.compactMap { $0.topCandidates(1).first }
        let text = candidates.map { $0.string }.joined(separator: "\n")
        guard text.filter({ !$0.isWhitespace }).count >= 30, !candidates.isEmpty else { fail("Unreadable or blank page \(index + 1); upload a clearer scan") }
        let confidence = candidates.reduce(Float(0)) { $0 + $1.confidence } / Float(candidates.count)
        guard confidence >= 0.8 else { fail("Low-confidence OCR on page \(index + 1); upload a clearer scan before payment") }
        let uncertain = candidates.filter { $0.confidence < 0.5 }.map { $0.string }.joined(separator: "; ")
        if !uncertain.isEmpty { print("OCR UNCERTAINTY page \(index + 1): low-confidence segments: \(uncertain)") }
        print("PAGE \(index + 1) [OCR; mean confidence \(String(format: "%.2f", confidence)); verify numbers against source]\n\(text)")
    }
}
