(function () {
  "use strict";
  var y = document.getElementById("year");
  if (y) y.textContent = String(new Date().getFullYear());

  var header = document.querySelector(".site-header");
  var bar = document.getElementById("mobile-bar");
  var hero = document.querySelector(".hero");
  var ticking = false;
  function onScroll() {
    ticking = false;
    var sy = window.scrollY;
    if (header) header.classList.toggle("scrolled", sy > 8);
    if (bar && hero) {
      var pastHero = sy > hero.offsetHeight - 120;
      var nearEnd = window.innerHeight + sy > document.body.scrollHeight - 260;
      bar.classList.toggle("show", pastHero && !nearEnd);
    }
  }
  window.addEventListener("scroll", function () {
    if (!ticking) { ticking = true; requestAnimationFrame(onScroll); }
  }, { passive: true });
  onScroll();
})();
