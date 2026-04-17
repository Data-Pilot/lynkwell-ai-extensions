// ReachAI — File Parser
// Client-side text extraction from uploaded files (.txt, .csv, .pdf, .docx)

const FileParser = {

  /**
   * Parse a File object and return extracted text
   * @param {File} file
   * @returns {Promise<{name: string, size: number, content: string}>}
   */
  async parse(file) {
    const ext = file.name.split('.').pop().toLowerCase();

    let content = '';

    switch (ext) {
      case 'txt':
      case 'csv':
      case 'md':
      case 'json':
        content = await this.readAsText(file);
        break;
      case 'pdf':
        content = await this.parsePDF(file);
        break;
      case 'docx':
        content = await this.parseDOCX(file);
        break;
      default:
        // Fallback: try reading as text
        try {
          content = await this.readAsText(file);
        } catch {
          throw new Error(`Unsupported file type: .${ext}`);
        }
    }

    // Clean and normalize the content
    content = this.cleanText(content);

    return {
      name: file.name,
      size: file.size,
      content: content,
      addedAt: Date.now()
    };
  },

  /**
   * Read file as plain text
   */
  readAsText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsText(file);
    });
  },

  /**
   * Read file as ArrayBuffer
   */
  readAsArrayBuffer(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsArrayBuffer(file);
    });
  },

  /**
   * Parse PDF using basic text extraction
   * Falls back to indicating PDF content if pdf.js isn't available
   */
  async parsePDF(file) {
    try {
      const arrayBuffer = await this.readAsArrayBuffer(file);
      // Simple PDF text extraction without pdf.js
      // Extract text between stream/endstream or BT/ET markers
      const bytes = new Uint8Array(arrayBuffer);
      let text = '';

      // Convert to string for basic parsing
      const decoder = new TextDecoder('utf-8', { fatal: false });
      const pdfString = decoder.decode(bytes);

      // Extract text from PDF text objects (between BT and ET)
      const textBlocks = pdfString.match(/BT[\s\S]*?ET/g);
      if (textBlocks) {
        for (const block of textBlocks) {
          // Extract text from Tj and TJ operators
          const tjMatches = block.match(/\(([^)]*)\)\s*Tj/g);
          if (tjMatches) {
            for (const match of tjMatches) {
              const extracted = match.match(/\(([^)]*)\)/);
              if (extracted) text += extracted[1] + ' ';
            }
          }
          // Extract from TJ arrays
          const tjArrays = block.match(/\[([^\]]*)\]\s*TJ/g);
          if (tjArrays) {
            for (const arr of tjArrays) {
              const strings = arr.match(/\(([^)]*)\)/g);
              if (strings) {
                for (const s of strings) {
                  const extracted = s.match(/\(([^)]*)\)/);
                  if (extracted) text += extracted[1];
                }
                text += ' ';
              }
            }
          }
        }
      }

      if (text.trim().length < 10) {
        // Fallback: try to find readable text anywhere in the PDF
        const readableText = pdfString.match(/[\x20-\x7E]{20,}/g);
        if (readableText) {
          text = readableText
            .filter(t => !t.includes('/') && !t.includes('<<') && !t.includes('stream'))
            .join(' ');
        }
      }

      return text || `[PDF file: ${file.name} — content could not be fully extracted. For best results, copy-paste the text into the context box below.]`;
    } catch (err) {
      return `[PDF file: ${file.name} — please copy-paste key content into the text box for best results.]`;
    }
  },

  /**
   * Parse DOCX by extracting text from the XML inside the zip
   */
  async parseDOCX(file) {
    try {
      const arrayBuffer = await this.readAsArrayBuffer(file);
      const bytes = new Uint8Array(arrayBuffer);

      // DOCX is a ZIP file — look for word/document.xml
      // Simple ZIP parsing: find the document.xml content
      const decoder = new TextDecoder('utf-8', { fatal: false });
      const content = decoder.decode(bytes);

      // Find XML text content between <w:t> tags
      const textMatches = content.match(/<w:t[^>]*>([^<]*)<\/w:t>/g);
      if (textMatches) {
        let text = '';
        let prevWasSpace = false;
        for (const match of textMatches) {
          const extracted = match.match(/<w:t[^>]*>([^<]*)<\/w:t>/);
          if (extracted && extracted[1]) {
            text += extracted[1];
            if (match.includes('xml:space="preserve"')) {
              // Keep the space
            }
          }
        }
        if (text.trim().length > 10) {
          return text;
        }
      }

      return `[DOCX file: ${file.name} — for best results, copy-paste the text content into the context box below.]`;
    } catch (err) {
      return `[DOCX file: ${file.name} — please copy-paste key content into the text box for best results.]`;
    }
  },

  /**
   * Clean and normalize extracted text
   */
  cleanText(text) {
    return text
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/\t/g, ' ')
      .replace(/ {3,}/g, '  ')
      .replace(/\n{4,}/g, '\n\n\n')
      .trim();
  },

  /**
   * Get supported file extensions
   */
  getSupportedExtensions() {
    return ['.txt', '.csv', '.md', '.json', '.pdf', '.docx'];
  },

  /**
   * Validate file before parsing
   */
  validate(file) {
    const ext = '.' + file.name.split('.').pop().toLowerCase();
    const supported = this.getSupportedExtensions();

    if (!supported.includes(ext)) {
      return { valid: false, error: `Unsupported file type: ${ext}. Supported: ${supported.join(', ')}` };
    }

    // 5MB limit per file
    if (file.size > 5 * 1024 * 1024) {
      return { valid: false, error: `File too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Max 5MB per file.` };
    }

    return { valid: true };
  }
};

if (typeof window !== 'undefined') {
  window.FileParser = FileParser;
}
