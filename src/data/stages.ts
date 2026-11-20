import type { Lesson, LessonPhase } from '../types'

/** The lesson contract: this order is shared by local lessons and AI validation. */
export const STAGES = [
  { id: 'observe', label: 'Quan sát', phase: 'observe', description: 'Nhận diện dáng lớn, các điểm ngoài cùng và hướng sáng trước khi có nét vẽ.' },
  { id: 'frame', label: 'Khung bao', phase: 'construct', description: 'Đặt khung giới hạn chiều cao và chiều rộng, giữ khoảng trống quanh chủ thể.' },
  { id: 'blocks', label: 'Dựng khối', phase: 'construct', description: 'Quy hình phức tạp về các khối đơn giản và dựng khối lớn trước.' },
  { id: 'proportion', label: 'Tỉ lệ', phase: 'construct', description: 'So trục, kích thước tương đối và khoảng cách giữa các phần của hình.' },
  { id: 'volume', label: 'Khối 3D', phase: 'construct', description: 'Dùng mặt cắt và nét ôm khối để thấy hướng quay và độ sâu của từng phần.' },
  { id: 'check', label: 'Kiểm tra', phase: 'refine', description: 'Đối chiếu khung, trục và các chỗ nối; sửa sai lệch lớn trước khi chọn nét chính.' },
  { id: 'erase', label: 'Tẩy đường dựng', phase: 'refine', description: 'Làm nhẹ các đường khung, trục và mặt cắt tạm, giữ lại mốc cần thiết.' },
  { id: 'contour', label: 'Nét chính', phase: 'refine', description: 'Đi nét chính theo từng phần, giữ đường bao liền mạch và thay đổi độ đậm hợp lý.' },
  { id: 'tone', label: 'Sắc độ', phase: 'shade', description: 'Chia vùng sáng, trung gian và tối rồi phủ nét từ nhạt đến đậm trong cùng một vùng.' },
  { id: 'shadow', label: 'Đổ bóng', phase: 'shade', description: 'Xác định bóng tiếp xúc và bóng đổ từ ảnh; dựng bóng sát điểm tựa trước khi làm mềm mép xa.' },
  { id: 'detail', label: 'Chi tiết', phase: 'refine', description: 'Chọn các dấu hiệu đặc trưng có thật trong ảnh và thêm lần lượt vào từng phần.' },
  { id: 'color', label: 'Lên màu', phase: 'finish', description: 'Phủ màu nền theo từng vùng, giữ quan hệ sáng tối và chừa vùng bắt sáng.' },
  { id: 'finish', label: 'Hoàn thiện', phase: 'finish', description: 'Cân lại tương phản, làm mềm các mép cần thiết và giữ rõ trọng tâm của bức vẽ.' },
] as const satisfies readonly { id: string; label: string; phase: LessonPhase; description: string }[]

const demonstrations: Record<typeof STAGES[number]['id'], {
  actions: string[]; tip: string; mistake: string; checkpoint: string; tool: string
}> = {
  observe: {
    actions: ['Quan sát vùng được đánh dấu: ứng dụng chỉ ra đỉnh, đáy và hai mốc rộng nhất mà chưa nối đường viền.', 'Theo dõi cách so chiều cao với chiều rộng và cách tìm hướng nghiêng của chủ thể.', 'Nhìn vị trí vùng sáng, vùng tối và điểm tựa trong ảnh; chi tiết chưa rõ sẽ được để trống.'],
    tip: 'Dáng lớn cần đọc được ngay cả khi các chi tiết nhỏ bị che đi.', mistake: 'Theo chi tiết nhỏ quá sớm dễ làm mất dáng tổng thể.', checkpoint: 'Các mốc giải thích được vị trí và dáng lớn của chủ thể.', tool: 'Ảnh tham chiếu và mốc quan sát',
  },
  frame: {
    actions: ['Theo dõi đầu bút đặt cạnh trên thật nhẹ từ trái sang phải.', 'Đầu bút kéo lần lượt cạnh phải xuống đáy, cạnh đáy về trái rồi nối lên cạnh trái.', 'Ứng dụng dừng ở khung bao để đối chiếu bốn mốc với ảnh, giữ khoảng trống bên ngoài chủ thể.'],
    tip: 'Khung là đường dẫn tạm, luôn nhẹ hơn nét chính.', mistake: 'Khung quá chật sẽ thiếu chỗ cho phần nhô ra và bóng đổ.', checkpoint: 'Khung giữ đúng chiều cao, chiều rộng và vị trí của chủ thể.', tool: 'Nét dựng nhạt',
  },
  blocks: {
    actions: ['Ứng dụng làm nổi vùng lớn nhất, chọn dạng khối phù hợp rồi tự phác đường bao đơn giản của khối đó.', 'Quan sát điểm đặt bút, hướng cong và điểm nhấc bút của từng nét, từ khối lớn sang khối nhỏ kế bên.', 'Các khối nối nhau được cho lấn nhẹ ở chỗ tiếp giáp; chỉ xong phần đang học mới chuyển vùng.'],
    tip: 'Một bộ phận nên đọc được như một khối đơn giản trước khi lên chi tiết.', mistake: 'Dựng mọi phần rải rác cùng lúc khiến khó theo dõi chỗ nối.', checkpoint: 'Các khối giữ đúng vị trí và gắn nhau thành dáng chung.', tool: 'Nét dựng khối',
  },
  proportion: {
    actions: ['Đầu bút dò trục chính từ mốc trên xuống mốc dưới bằng một nét rất nhẹ.', 'Các mốc ngang được đặt lần lượt tại chỗ nở, chỗ thắt hoặc chỗ nối đã thấy trong ảnh.', 'Ứng dụng so khoảng cách hai bên trục và điều chỉnh riêng mốc lệch trước khi chuyển phần.'],
    tip: 'So cả khoảng trống giữa các phần, không chỉ so kích thước của từng phần.', mistake: 'Ép mọi chủ thể vào hình đối xứng sẽ làm sai hướng nghiêng.', checkpoint: 'Các điểm đặc trưng nằm đúng cao độ và khoảng cách tương đối.', tool: 'Trục và mốc tỉ lệ',
  },
  volume: {
    actions: ['Quan sát một vùng khối: ứng dụng xác định mặt hướng về người xem và mặt quay ra xa.', 'Đầu bút phác mặt cắt hoặc nét ôm khối từ mép gần sang mép xa, cho mặt khuất nhạt hơn.', 'Nét tiếp theo chỉ xuất hiện sau khi nét trước kết thúc, giúp thấy khối có độ cong và chiều sâu.'],
    tip: 'Mặt cắt thay đổi độ cong theo hướng quay của khối.', mistake: 'Nét ngang phẳng lặp đều trên mọi mặt dễ làm khối trông như tấm bìa.', checkpoint: 'Hướng quay và các mặt gần, xa của khối phân biệt được.', tool: 'Mặt cắt và nét ôm khối',
  },
  check: {
    actions: ['Ứng dụng tạm dừng phác mới để so khung bao, trục và điểm tiếp giáp với ảnh.', 'Vùng cần chú ý được đánh dấu riêng: quan sát vị trí cần nới, thu hoặc dịch mốc.', 'Đầu bút chỉnh lại một đoạn tại vùng đó rồi đối chiếu lần nữa trước khi tẩy đường dựng.'],
    tip: 'Sửa một sai lệch lớn thường hữu ích hơn thêm nhiều nét nhỏ.', mistake: 'Tô đậm để che tỉ lệ sai sẽ khiến việc sửa khó hơn.', checkpoint: 'Dáng lớn, trục và chỗ nối đã nhất quán trước khi đi nét chính.', tool: 'Mốc đối chiếu và nét chỉnh nhẹ',
  },
  erase: {
    actions: ['Ứng dụng chỉ rõ đường khung và trục nào là đường tạm cần làm nhẹ.', 'Theo dõi nét dựng mờ dần theo từng phần; đường bao và các mốc cần giữ vẫn đọc được.', 'Vùng đã làm sạch được đối chiếu với ảnh trước khi đầu bút chuyển sang nét chính.'],
    tip: 'Giữ một ít nét dựng mờ có thể giúp thấy quá trình phát triển của khối.', mistake: 'Xóa cùng lúc cả nét dựng lẫn nét đúng sẽ làm mất các mốc vừa căn.', checkpoint: 'Đường tạm đã nhẹ đi trong khi dáng và chỗ nối vẫn rõ.', tool: 'Tẩy mô phỏng theo vùng',
  },
  contour: {
    actions: ['Đầu bút đặt ở mốc đầu của phần đang học, kéo theo đường bao đến mốc cuối rồi nhấc bút.', 'Quan sát cách nối các cung qua chỗ nở, thắt và tiếp giáp, hoàn tất một phần trước khi chuyển phần khác.', 'Nét ở vùng sáng được giữ nhẹ; các chỗ khuất hoặc tiếp xúc được nhấn vừa đủ.'],
    tip: 'Một cung có hướng rõ dễ đọc hơn nhiều nét ngắn chồng rối.', mistake: 'Viền đậm đều mọi cạnh sẽ làm hình phẳng và tách khỏi nền.', checkpoint: 'Đường bao liền mạch, giữ tỉ lệ và có chỗ đậm, chỗ nhẹ.', tool: 'Nét chính',
  },
  tone: {
    actions: ['Ứng dụng chia vùng đang học thành sáng, trung gian và tối theo ảnh tham chiếu.', 'Các nét phủ nhẹ lần lượt theo hướng mặt khối; đầu bút nhấc dần ở cuối mỗi nét.', 'Lớp kế tiếp tăng mật độ trong vùng tối và giữ vùng sáng thoáng, không tô đồng loạt cả hình.'],
    tip: 'Độ đậm tăng bằng các lớp nhẹ giúp dễ thấy hướng bề mặt.', mistake: 'Phủ kín ngay lớp đầu sẽ mất quan hệ sáng, tối và vùng bắt sáng.', checkpoint: 'Các mảng sắc độ làm rõ thể tích mà không che mất vùng sáng.', tool: 'Nét sắc độ nhiều lớp',
  },
  shadow: {
    actions: ['Ứng dụng xác định hướng bóng và vùng tiếp xúc nhìn thấy trong ảnh; ảnh không có bóng rõ thì chỉ đối chiếu, không tự thêm.', 'Đầu bút đặt bóng tiếp xúc sát điểm tựa trước, sau đó kéo các nét bóng ra phía xa.', 'Quan sát mép bóng nhạt và mềm dần khi rời điểm tiếp xúc, giữ bóng bám đúng mặt đỡ.'],
    tip: 'Bóng tiếp xúc giúp vật có trọng lượng và đứng trên mặt phẳng.', mistake: 'Viền cứng đều quanh bóng khiến nó giống một miếng dán.', checkpoint: 'Bóng nối với điểm tựa và có hướng nhất quán với ánh sáng.', tool: 'Nét bóng tiếp xúc và bóng đổ',
  },
  detail: {
    actions: ['Ứng dụng chọn một vùng chi tiết đặc trưng thực sự thấy trong ảnh rồi chỉ rõ mốc bắt đầu.', 'Đầu bút tự vẽ từng nét ngắn theo cấu trúc của vùng đó, giảm lực ở đầu xa.', 'Xong nhóm chi tiết hiện tại, ứng dụng mới chuyển sang nhóm tiếp theo; các vân nền không cần thiết được lược bỏ.'],
    tip: 'Ít chi tiết có cấu trúc rõ thường dễ học hơn nhiều vân nhỏ rải đều.', mistake: 'Đuổi theo mọi đốm và vân nhiễu sẽ làm mất trọng tâm.', checkpoint: 'Chi tiết giúp nhận ra chủ thể mà không làm rối khối lớn.', tool: 'Nét chi tiết mảnh',
  },
  color: {
    actions: ['Ứng dụng lấy các màu hoặc sắc xám chính trong ảnh và xác định vùng sẽ phủ trước.', 'Màu nền được phủ nhẹ theo từng vùng, giữ nguyên mảng sáng và quan hệ sắc độ đã dựng.', 'Lớp màu tiếp theo tăng dần ở mặt tối hoặc chỗ giao; ảnh đơn sắc được giữ đúng sắc xám của ảnh.'],
    tip: 'Màu hỗ trợ thể tích đã có; không cần phủ đậm đều mọi mặt.', mistake: 'Đổi màu nhưng bỏ quan hệ sáng, tối sẽ làm khối mất chiều sâu.', checkpoint: 'Màu bám ảnh và các mặt sáng, tối vẫn đọc được.', tool: 'Lớp màu tham chiếu',
  },
  finish: {
    actions: ['Ứng dụng lùi về toàn hình để đối chiếu dáng, tỉ lệ, ánh sáng và điểm tựa.', 'Từng vùng được chỉnh nhẹ: giảm nét thừa, giữ rõ điểm nhấn và làm êm chỗ chuyển sắc.', 'Bài trình diễn dừng ở hình hoàn thiện; người xem có thể phát lại bất kỳ phần nào để theo dõi đường đi của bút.'],
    tip: 'Quan sát cả hình trước khi quyết định có cần thêm một nét nữa hay không.', mistake: 'Nhấn đậm toàn bộ ở phút cuối sẽ làm mất độ mềm và trọng tâm.', checkpoint: 'Hình có dáng rõ, khối nhất quán và các mép được hoàn thiện vừa đủ.', tool: 'Nét chỉnh cuối và toàn cảnh',
  },
}

export function createLesson(referenceName: string, difficulty = 'Mới bắt đầu'): Lesson {
  const name = referenceName.trim() || 'ảnh tham chiếu'
  const steps = STAGES.map(stage => ({
    title: stage.label,
    shortTitle: stage.label,
    phase: stage.phase,
    duration: stage.id === 'observe' || stage.id === 'check' ? 2 : 3,
    description: stage.description,
    ...demonstrations[stage.id],
    actions: [...demonstrations[stage.id].actions],
  }))
  return {
    title: `Từng nét từ ${name}`,
    subject: name,
    description: `Ứng dụng tự dựng và hoàn thiện “${name}” qua 13 giai đoạn. Người xem theo dõi từng phần, từng nét và có thể tạm dừng hoặc phát lại.`,
    difficulty,
    duration: steps.reduce((sum, step) => sum + step.duration, 0),
    observations: ['Khung, khối và tỉ lệ được xác định trước khi chọn nét chính.', 'Một vùng được trình diễn xong trước khi đầu bút chuyển sang vùng kế tiếp.', 'Nét, sắc độ, bóng và màu được đối chiếu với ảnh; chi tiết không rõ sẽ không bị đoán thêm.'],
    palette: ['#FAF8F1', '#D8D3C5', '#A9A18B', '#797565', '#485041'],
    steps,
  }
}
