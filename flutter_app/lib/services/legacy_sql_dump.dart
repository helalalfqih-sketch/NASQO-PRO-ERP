/// Data-only reader for SmartPro-style SQL dumps. It never executes SQL.
/// Only literal INSERT ... VALUES records in recognized tables are mapped.
class LegacySqlDump {
  static const tables=['customers','accounts','stores','products','currencies','boxes','cboxes',
    'input_move','bounds','bill_details','bill_details2','store_trans','trans_details','offers',
    'offer_bill_details','offer_sbill_details','bin','bin_bill_details','bin_bill_details2','alerts'];
  static const _ident=r'(?:"[A-Za-z_][A-Za-z0-9_]*"|[A-Za-z_][A-Za-z0-9_]*|BACKTICK_IDENTIFIER)';
  static String get _identifier=>_ident.replaceFirst('BACKTICK_IDENTIFIER',r'`[A-Za-z_][A-Za-z0-9_]*`');
  static final _create=RegExp(r'^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?('+_identifier+r')\s*\(',caseSensitive:false);
  static final _insert=RegExp(r'^INSERT\s+INTO\s+('+_identifier+r')\s*(?:\(([^()]*)\)\s*)?VALUES\b',caseSensitive:false);
  static final _name=RegExp(r'^'+_identifier+r'$',caseSensitive:false);
  static final _column=RegExp(r'^('+_identifier+r')\s+',caseSensitive:false);
  static final _constraint=RegExp(r'^(?:PRIMARY|FOREIGN|UNIQUE|KEY|INDEX|CONSTRAINT|CHECK|FULLTEXT|SPATIAL)\b',caseSensitive:false);
  static final _metadata=RegExp(r'^(?:SET\b|START\s+TRANSACTION\b|BEGIN(?:\s+TRANSACTION)?\s*$|COMMIT\s*$|LOCK\s+TABLES\b|UNLOCK\s+TABLES\b|DROP\s+TABLE\b|ALTER\s+TABLE\b|PRAGMA\b|CREATE\s+(?:UNIQUE\s+)?INDEX\b)',caseSensitive:false);
  static final _number=RegExp(r'^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$');

  static bool looksLike(String input,String fileName)=>RegExp(r'\.sql(?:\.gz)?$',caseSensitive:false).hasMatch(fileName)||
    RegExp(r'^\s*(?:--|#|/\*|CREATE\s+TABLE\b|INSERT\s+INTO\b|SET\s|PRAGMA\s|BEGIN\b)',caseSensitive:false).hasMatch(input);

  static String _id(String text){
    final v=text.trim();
    if(!_name.hasMatch(v))throw const FormatException('Unsupported SQL identifier');
    return (v.startsWith('"')||v.codeUnitAt(0)==96?v.substring(1,v.length-1):v).toLowerCase();
  }
  static bool _quoted(String ch)=>ch=="'"||ch=='"'||ch.codeUnitAt(0)==96;

  /// Split at an unquoted, top-level separator. SQL comments are stripped
  /// only when scanning whole statements. Quoted semicolons are data.
  static Iterable<String> _split(String input,String separator,{bool comments=false})sync*{
    var buf=StringBuffer(),depth=0;
    String? quote;
    for(var i=0;i<input.length;i++){
      final ch=input[i],next=i+1<input.length?input[i+1]:'';
      if(quote!=null){
        buf.write(ch);
        if(ch=='\\'&&quote.codeUnitAt(0)!=96){
          if(i+1>=input.length)throw const FormatException('Unterminated SQL escape');
          buf.write(input[++i]);
        }else if(ch==quote){
          if(next==quote){buf.write(input[++i]);}else{quote=null;}
        }
        continue;
      }
      if(comments&&((ch=='-'&&next=='-')||ch=='#')){
        while(i+1<input.length&&input[i+1]!='\n')i++;
        buf.write(' ');continue;
      }
      if(comments&&ch=='/'&&next=='*'){
        final end=input.indexOf('*/',i+2);
        if(end<0)throw const FormatException('Unterminated SQL comment');
        i=end+1;buf.write(' ');continue;
      }
      if(_quoted(ch)){quote=ch;buf.write(ch);continue;}
      if(ch=='(')depth++;
      if(ch==')'){
        depth--;
        if(depth<0)throw const FormatException('Unbalanced SQL tuple');
      }
      if(ch==separator&&depth==0){yield buf.toString().trim();buf=StringBuffer();}
      else{buf.write(ch);}
    }
    if(quote!=null||depth!=0)throw const FormatException('Incomplete SQL statement');
    if(buf.isNotEmpty)yield buf.toString().trim();
  }

  static Object? _literal(String text){
    final v=text.trim();
    if(v.toUpperCase()=='NULL')return null;
    if(v.isEmpty)throw const FormatException('Empty SQL value');
    if(v.startsWith("'")||v.startsWith('"')){
      final quote=v[0],out=StringBuffer();
      var closed=false;
      for(var i=1;i<v.length;i++){
        final ch=v[i];
        if(ch=='\\'){
          if(i+1>=v.length)throw const FormatException('Incomplete SQL escape');
          final n=v[++i];
          out.write(const {'0':'\x00','b':'\b','n':'\n','r':'\r','t':'\t','Z':'\x1a'}[n]??n);
        }else if(ch==quote){
          if(i+1<v.length&&v[i+1]==quote){out.write(quote);i++;}
          else if(i==v.length-1){closed=true;break;}
          else{throw const FormatException('SQL expression is not a literal');}
        }else{out.write(ch);}
      }
      if(!closed)throw const FormatException('Unterminated SQL string');
      return out.toString();
    }
    if(!_number.hasMatch(v))throw const FormatException('Only literal SQL values are supported');
    final n=num.tryParse(v);
    if(n==null||!n.isFinite)throw const FormatException('Invalid SQL number');
    return n;
  }

  static Map<String,List<Map<String,dynamic>>> parse(String input){
    final known=tables.toSet(),columns=<String,List<String>>{},data=<String,List<Map<String,dynamic>>>{};
    var count=0;
    for(final statement in _split(input,';',comments:true)){
      if(statement.isEmpty)continue;
      final create=_create.firstMatch(statement);
      if(create!=null){
        final table=_id(create[1]!);
        if(!known.contains(table))continue;
        if(columns.containsKey(table))throw const FormatException('Repeated SQL table definition');
        // CREATE column definitions are data metadata, never executable.
        final close=statement.lastIndexOf(')');
        if(close<create.end)throw const FormatException('Missing SQL column definitions');
        final names=<String>[];
        for(final part in _split(statement.substring(create.end,close),',')){
          if(_constraint.hasMatch(part))continue;
          final col=_column.firstMatch(part);
          if(col==null)throw const FormatException('Unsupported SQL column definition');
          final name=_id(col[1]!);
          if(names.contains(name)||names.length>=256)throw const FormatException('Duplicate or excessive SQL columns');
          names.add(name);
        }
        if(names.isEmpty)throw const FormatException('Empty SQL schema');
        columns[table]=names;data.putIfAbsent(table,()=>[]);
        continue;
      }
      final insert=_insert.firstMatch(statement);
      if(insert!=null){
        final table=_id(insert[1]!);
        // Other legacy tables (for example users and permissions) are
        // retained byte-for-byte in the source, never activated as accounts.
        if(!known.contains(table))continue;
        final cols=insert[2]==null?columns[table]:insert[2]!.split(',').map(_id).toList();
        if(cols==null||cols.isEmpty||cols.length>256||cols.toSet().length!=cols.length)
          throw const FormatException('SQL INSERT needs unique column names');
        final rows=data.putIfAbsent(table,()=>[]);
        final tail=statement.substring(insert.end).trim();
        if(tail.isEmpty)throw const FormatException('Missing SQL VALUES');
        for(final tuple in _split(tail,',')){
          if(!tuple.startsWith('(')||!tuple.endsWith(')'))throw const FormatException('Expected SQL literal tuple');
          final vals=_split(tuple.substring(1,tuple.length-1),',').map(_literal).toList();
          if(vals.length!=cols.length)throw const FormatException('SQL column/value count mismatch');
          if(rows.length>=100000||++count>300000)throw const FormatException('Too many SQL rows');
          rows.add({for(var i=0;i<cols.length;i++)cols[i]:vals[i]});
        }
        continue;
      }
      if(_metadata.hasMatch(statement)){
        if(statement.toUpperCase().contains('NO_BACKSLASH_ESCAPES'))throw const FormatException('Unsupported SQL escape mode');
        continue;
      }
      throw const FormatException('Unsupported SQL statement; only SmartPro data dumps are accepted');
    }
    if(data.containsKey('accounts')&&data.containsKey('customers')&&data['accounts']!.isNotEmpty&&data['customers']!.isNotEmpty)
      throw const FormatException('Ambiguous account tables');
    if(data.containsKey('bounds')&&data.containsKey('input_move')&&data['bounds']!.isNotEmpty&&data['input_move']!.isNotEmpty)
      throw const FormatException('Ambiguous movement tables');
    if(!data.containsKey('customers')||data['customers']!.isEmpty){
      if(data.containsKey('accounts'))data['customers']=data['accounts']!;
    }
    if(!data.containsKey('input_move')||data['input_move']!.isEmpty){
      if(data.containsKey('bounds'))data['input_move']=data['bounds']!;
    }
    if(!['customers','stores','products','input_move'].every(data.containsKey))
      throw const FormatException('Not a recognized SmartPro SQL backup');
    const required=<String,List<List<String>>>{
      'customers':[['id'],['name']],
      'stores':[['id'],['name']],
      'products':[['id'],['name']],
      'currencies':[['id'],['name']],
      'boxes':[['id'],['name']],
      'cboxes':[['id'],['name']],
      'input_move':[['id'],['per_id','acc_id'],['dain'],['madin'],['bill_type','doc_type'],['cur','cur_id']],
      'bill_details':[['id'],['bill_id'],['prod_id'],['amount'],['price'],['total']],
      'bill_details2':[['id'],['bill_id'],['amount'],['price'],['total']],
      'store_trans':[['id'],['store_id1'],['store_id2']],
      'trans_details':[['id'],['bill_id'],['prod_id'],['amount']],
    };
    for(final e in required.entries){
      for(final row in data[e.key]??<Map<String,dynamic>>[]){
        if(e.value.any((alternatives)=>!alternatives.any((key)=>row[key]!=null)))
          throw FormatException('Required SQL field missing in '+e.key);
      }
    }
    return {for(final table in tables)table:data[table]??<Map<String,dynamic>>[]};
  }
}
