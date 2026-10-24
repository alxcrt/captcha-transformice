package org.transformice.database.embeds;

// Imports
import static org.transformice.utils.Utils.getUnixTime;
import dev.morphia.annotations.Embedded;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Getter
@Embedded
@NoArgsConstructor(force = true)
public class ReportReporter {
    private final String playerName;
    private final String reportComment;
    private final short playerKarma;
    private final int reportType;
    private final long reportAge;

    public ReportReporter(String playerName, String reportComment, int reportType, short playerKarma) {
        this.playerName = playerName;
        this.reportComment = reportComment;
        this.playerKarma = playerKarma;
        this.reportType = reportType;
        this.reportAge = getUnixTime();
    }
}