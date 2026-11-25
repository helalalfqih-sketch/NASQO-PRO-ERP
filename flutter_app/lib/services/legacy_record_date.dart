/// Read a source calendar date without relying on DateTime's overflow repair.
/// Old SQLite archives store day/month/year and ndate rather than `date`.
/// This runs when reading the archive, so existing imports need no re-import.
class LegacyRecordDate {
  static String read(Map<String,dynamic> row) {
    final explicit=_iso(row['date']);
    if(explicit.isNotEmpty)return explicit;
    final parts=_calendar(_integer(row['year']),_integer(row['month']),_integer(row['day']));
    if(parts.isNotEmpty)return parts;
    final compact=row['ndate']?.toString().trim()??'';
    if(!RegExp(r'^\d{8}$').hasMatch(compact))return '';
    return _calendar(int.parse(compact.substring(0,4)),int.parse(compact.substring(4,6)),int.parse(compact.substring(6,8)));
  }

  static int? _integer(Object? value) {
    final text=value?.toString().trim()??'';
    return RegExp(r'^\d+$').hasMatch(text)?int.tryParse(text):null;
  }

  static String _iso(Object? value) {
    final text=value?.toString().trim()??'';
    final match=RegExp(r'^(\d{4})-(\d{2})-(\d{2})$').firstMatch(text);
    if(match==null)return '';
    return _calendar(int.parse(match[1]!),int.parse(match[2]!),int.parse(match[3]!));
  }

  static String _calendar(int? year,int? month,int? day) {
    if(year==null||month==null||day==null||year<1||year>9999||month<1||month>12||day<1||day>31)return '';
    final date=DateTime.utc(year,month,day);
    if(date.year!=year||date.month!=month||date.day!=day)return '';
    return '${year.toString().padLeft(4,'0')}-${month.toString().padLeft(2,'0')}-${day.toString().padLeft(2,'0')}';
  }
}
