/* 08-code — строки, которые собираются в коде и не видны в статическом
   инвентаре: формулы (построчно), заметки движка, пустое состояние графика.
   Ключи, уже переведённые в других кусках, здесь не дублируются
   (пересборка: node tools/i18n-assemble.cjs). */
window.MC_EN = Object.assign(window.MC_EN || {}, {
  "M(s) = 2·Mmax / (s/sкр + sкр/s) + ΔM·s³": "M(s) = 2·Mmax / (s/scr + scr/s) + ΔM·s³",
  "sкр = sн · (Mmax/Mн + √((Mmax/Mн)² − 1))": "scr = sₙ · (Mmax/Mₙ + √((Mmax/Mₙ)² − 1))",
  "ΔM = Mп − M(s=1)": "ΔM = Mst − M(s=1)",
  "Iдоп = Iтабл · kтемп · kгруп · kспособ · kизол · kпарал": "Iadm = Itable · ktemp · kgroup · kmethod · kins · kpar",
  "R = ρ·L/S,   X ≈ 0,08 Ом/км": "R = ρ·L/S,   X ≈ 0.08 Ω/km",
  "Iн.авт ≥ 1,25·Iн;   Iотс > 1,1·Iп": "Iₙ.brk ≥ 1.25·Iₙ;   Itrip > 1.1·Ist",
  "S ≥ Iкз·√t / k": "S ≥ Isc·√t / k",
  "J · dω/dt = Mдв(s) − Mс(n)": "J · dω/dt = Mmot(s) − Mload(n)",
  "нет данных": "no data",
  "Паспортные данные: ": "Nameplate data: ",
  "Мощность восстановлена по току; КПД и cosφ — типовые": "Power restored from current; efficiency and cosφ are typical",
  " (заданы вручную)": " (set manually)",
  "Мощность определена по моменту и скорости": "Power derived from torque and speed",
  " · однофазный, ": " · single-phase, ",
  " (типовые данные)": " (typical data)",
  "конденсаторный": "capacitor-start",
  "с расщеплённой фазой": "split-phase",
  "Причина: схема Y при 380 В для 380/660 снижает момент примерно в 3 раза. Переключите обмотки на Δ и повторите расчёт.": "Cause: the Y connection at 380 V on a 380/660 motor reduces torque about three times. Switch the windings to Δ and recalculate.",
  "Причина: пусковой момент меньше момента нагрузки уже на малой скорости. Уменьшите нагрузку, добавьте разгрузку или выберите другой способ пуска.": "Cause: the starting torque is already below the load torque at low speed. Reduce the load, add load relief or choose another starting method.",
  "Причина: нагрузка выше номинальной; двигатель не дотягивает до рабочей точки. Проверьте запас по моменту.": "Cause: the load is above rated and the motor cannot reach the operating point. Check the torque margin.",
  "Однофазный: прямой пуск с пусковой обмоткой/конденсатором; для регулирования — частотный привод.": "Single-phase: direct start with a starting winding/capacitor; use a VFD for speed control.",
  "Схема Y при 380 В для двигателя 380/660 снижает момент примерно в 3 раза. Переключите на Δ; после этого проверьте пуск.": "The Y connection at 380 V on a 380/660 motor reduces torque about three times. Switch to Δ, then check the start.",
  "Нагрузка выше пускового момента в звезде (Mп/3): Y–Δ и автотрансформатор не разгонят. Нужен прямой пуск, софтстартер или ПЧ с проверкой момента.": "The load is above the star-connection starting torque (Mst/3): Y–Δ and autotransformer starting will not accelerate it. Use a DOL start, a soft starter or a VFD with a torque check.",
  "Рекомендация: прямой пуск допустим — пусковой ток невелик, сеть обычно выдерживает.": "Recommendation: a DOL start is acceptable — the starting current is small and the supply usually handles it.",
  "Рекомендация: «звезда–треугольник», софтстартер или частотный привод — прямой пуск даёт большой бросок тока.": "Recommendation: star–delta, a soft starter or a VFD — a DOL start gives a large current surge.",
  "Рекомендация: частотный привод или софтстартер с ограничением тока; прямой пуск требует отдельной проверки сети.": "Recommendation: a VFD or a current-limited soft starter; a DOL start requires a separate supply check."
});
