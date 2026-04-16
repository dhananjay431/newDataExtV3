const pdfPath = "raj_PDF3.pdf";
const jsonPath1 = "content-understanding.json";
const scale = 1.5;
const pointsPerInch = 72;

function calculatePDI(pageInfo) {
  return {
    widthPoints: pageInfo.width * pointsPerInch,
    heightPoints: pageInfo.height * pointsPerInch,
    widthPixels: pageInfo.width * pointsPerInch * scale,
    heightPixels: pageInfo.height * pointsPerInch * scale,
  };
}

let pdfDoc = null;
let jsonData = null;
let fields = [];
let overlays = {};
let pageDimensions = {};
let activeLeaderLine = null;

window.addEventListener("resize", () => {
  if (activeLeaderLine) {
    activeLeaderLine.position();
  }
});

async function loadData() {
  try {
    const [jsonResponse, pdfResponse] = await Promise.all([
      fetch(jsonPath1),
      fetch(pdfPath),
    ]);

    jsonData = await jsonResponse.json();
    const contents = jsonData.result.contents[0];
    document.getElementById("markdown-content").innerHTML =
      contents.markdown || "";

    pageDimensions = (contents.pages || []).reduce((acc, page) => {
      acc[page.pageNumber] = page;
      return acc;
    }, {});

    const pdfArrayBuffer = await pdfResponse.arrayBuffer();
    pdfDoc = await pdfjsLib.getDocument({ data: pdfArrayBuffer }).promise;

    parseFields();
    await renderPDF();
    populateSidebar();
  } catch (error) {
    console.error("Error loading data:", error);
  }
}

function parseFields() {
  const contents = jsonData.result.contents[0];
  const allFields = contents.fields;

  function flattenFields(obj, prefix = "") {
    for (const key in obj) {
      if (obj[key] && typeof obj[key] === "object") {
        if (obj[key].source) {
          fields.push({
            key: prefix + key,
            ...obj[key],
            sourceData: parseSourceData(obj[key].source),
          });
        } else if (obj[key].valueArray) {
          obj[key].valueArray.forEach((item, index) => {
            if (item.valueObject) {
              flattenFields(item.valueObject, `${prefix}${key}[${index}].`);
            }
          });
        } else if (obj[key].valueObject) {
          flattenFields(obj[key].valueObject, `${prefix}${key}.`);
        } else {
          flattenFields(obj[key], `${prefix}${key}.`);
        }
      }
    }
  }

  flattenFields(allFields);
}

async function renderPDF() {
  const container = document.getElementById("pdf-container");
  container.innerHTML = "";
  overlays = {};

  for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
    const page = await pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale });

    const pageDiv = document.createElement("div");
    pageDiv.className = "pdf-page";
    pageDiv.id = `page-${pageNum}`;

    const canvas = document.createElement("canvas");
    canvas.className = "pdf-canvas";
    canvas.id = `canvas-${pageNum}`;
    canvas.height = viewport.height;
    canvas.width = viewport.width;

    const context = canvas.getContext("2d");
    await page.render({ canvasContext: context, viewport }).promise;

    const overlay = document.createElement("div");
    overlay.className = "overlay";
    overlay.style.width = `${viewport.width}px`;
    overlay.style.height = `${viewport.height}px`;

    pageDiv.appendChild(canvas);
    pageDiv.appendChild(overlay);
    container.appendChild(pageDiv);

    overlays[pageNum] = overlay;
  }

  addBoundingBoxes();
}

function addBoundingBoxes() {
  fields.forEach((field) => {
    if (!field.sourceData) return;

    const { page, x, y, width, height } = field.sourceData;
    const overlay = overlays[page];
    let a = field.sourceData.points.map((d) => d * 108);
    console.log(a);
    if (!overlay) return;

    const box = document.createElement("div");
    box.className = "bounding-box";
    box.id = `box-${field.key}`;
    box.style.left = `${a[0]}px`;
    box.style.top = `${a[1]}px`;
    box.style.width = `${a[2] - a[0]}px`;
    box.style.height = `${a[5] - a[3]}px`;

    if (field.confidence < 0.5) {
      box.classList.add("confidence-low");
    } else if (field.confidence < 0.8) {
      box.classList.add("confidence-medium");
    } else {
      box.classList.add("confidence-high");
    }

    overlay.appendChild(box);
  });
}

function parseSourceData(sourceStr) {
  const match = sourceStr.match(
    /D\((\d+),([\d.]+),([\d.]+),([\d.]+),([\d.]+),([\d.]+),([\d.]+),([\d.]+),([\d.]+)\)/,
  );
  if (!match) return null;

  const page = parseInt(match[1], 10);
  const coords = match.slice(2).map(parseFloat);
  const xs = [coords[0], coords[2], coords[4], coords[6]];
  const ys = [coords[1], coords[3], coords[5], coords[7]];
  const pageInfo = pageDimensions[page] || { width: 8.5, height: 11 };
  const pdi = calculatePDI(pageInfo);
  const pageHeightPoints = pdi.heightPoints;

  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);

  const x = xMin * pointsPerInch * scale;
  const y = (pageHeightPoints - yMax * pointsPerInch) * scale;
  const width = (xMax - xMin) * pointsPerInch * scale;
  const height = (yMax - yMin) * pointsPerInch * scale;

  return {
    page,
    x,
    y,
    width,
    height,
    points: coords,
    pageInfo,
  };
}

function populateSidebar() {
  const fieldsList = document.getElementById("fields-list");
  fieldsList.innerHTML = "";

  const groups = {};
  fields.forEach((field) => {
    const category = field.key.split(".")[0];
    if (!groups[category]) groups[category] = [];
    groups[category].push(field);
  });

  for (const category in groups) {
    const groupDiv = document.createElement("div");
    groupDiv.className = "field-group";

    const title = document.createElement("h3");
    title.textContent = category;
    groupDiv.appendChild(title);

    groups[category].forEach((field) => {
      const item = document.createElement("div");
      item.className = "field-item";
      item.dataset.key = field.key;

      const label = document.createElement("div");
      label.className = "field-label";
      label.textContent = field.key.split(".").pop();

      const value = document.createElement("div");
      value.className = "field-value";
      value.textContent = field.valueString || field.valueNumber || "N/A";

      item.appendChild(label);
      item.appendChild(value);
      item.addEventListener("click", () => highlightField(field.key));
      item.addEventListener("mouseenter", () => hoverField(field.key, item));
      item.addEventListener("mouseleave", () => unhoverField(field.key));
      groupDiv.appendChild(item);
    });

    fieldsList.appendChild(groupDiv);
  }
}

function highlightField(key) {
  document.querySelectorAll(".bounding-box.highlighted").forEach((box) => {
    box.classList.remove("highlighted");
  });
  document.querySelectorAll(".field-item.selected").forEach((item) => {
    item.classList.remove("selected");
  });

  const box = document.getElementById(`box-${key}`);
  if (box) {
    box.classList.add("highlighted");
    const pageNum = box.closest(".pdf-page").id.split("-")[1];
    document
      .getElementById(`page-${pageNum}`)
      .scrollIntoView({ behavior: "smooth" });
  }

  const item = document.querySelector(`[data-key="${key}"]`);
  if (item) item.classList.add("selected");
}

function hoverField(key, listItem) {
  const box = document.getElementById(`box-${key}`);
  if (box) {
    box.classList.add("hovered");
    createHoverLeaderLine(listItem, box);
  }
}

function unhoverField(key) {
  const box = document.getElementById(`box-${key}`);
  if (box) {
    box.classList.remove("hovered");
  }
  removeHoverLeaderLine();
}

function createHoverLeaderLine(startElement, endElement) {
  removeHoverLeaderLine();
  if (!window.LeaderLine || !startElement || !endElement) return;

  activeLeaderLine = new LeaderLine(startElement, endElement, {
    path: "fluid",
    startSocket: "right",
    endSocket: "left",
    color: "#00aaff",
    size: 2,
    dash: { animation: true },
    gradient: true,
    startPlug: "disc",
    endPlug: "arrow1",
  });
}

function removeHoverLeaderLine() {
  if (activeLeaderLine) {
    activeLeaderLine.remove();
    activeLeaderLine = null;
  }
}

document.addEventListener("DOMContentLoaded", loadData);
