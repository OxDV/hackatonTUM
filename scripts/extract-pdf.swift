import Foundation
import PDFKit
for path in CommandLine.arguments.dropFirst() {
 guard let doc = PDFDocument(url: URL(fileURLWithPath: path)) else { fatalError("Cannot read PDF") }
 print("FILE: \(URL(fileURLWithPath: path).lastPathComponent)")
 for index in 0..<doc.pageCount { print("PAGE \(index+1)\n\(doc.page(at:index)?.string ?? "")") }
}
