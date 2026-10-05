// On narrow screens the chart scrolls sideways. Open it far enough in to show
// the 1980s stacks while keeping the first entry, UNIX, in view, and
// fade only the edge that still has chart beyond it.
const scroller = document.querySelector(".chart-scroll");

function markEdges() {
  const max = scroller.scrollWidth - scroller.clientWidth;
  scroller.classList.toggle("has-left", scroller.scrollLeft > 4);
  scroller.classList.toggle("has-right", scroller.scrollLeft < max - 4);
}

if (scroller && scroller.scrollWidth > scroller.clientWidth) {
  const unix = scroller.querySelector('.node[href="#p01"] rect');
  const svg = scroller.querySelector("svg");
  const scale = svg.getBoundingClientRect().width / svg.viewBox.baseVal.width;
  scroller.scrollLeft = unix ? Math.max(0, unix.x.baseVal.value * scale - 16) : 0;
  markEdges();
  scroller.addEventListener("scroll", markEdges, { passive: true });
}
