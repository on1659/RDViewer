import AppKit
import Foundation

// A dedicated command-line helper: do not create NSApplication or any windows.
// Only family names are returned, never font file paths or font data.
struct FontFamily: Encodable {
    let family: String
    let displayName: String
}

let manager = NSFontManager.shared
let families = manager.availableFontFamilies.map { family in
    FontFamily(family: family, displayName: manager.localizedName(forFamily: family, face: nil))
}
do {
    let data = try JSONEncoder().encode(families)
    FileHandle.standardOutput.write(data)
} catch {
    FileHandle.standardError.write(Data("Unable to read installed font families.\n".utf8))
    exit(1)
}
